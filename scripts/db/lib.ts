/**
 * Shared by the db:* scripts. These run with the ADMIN (owner) connection: they create the schema, provision the
 * runtime role and seed data. The running application never uses it.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import * as schema from "../../src/db/schema";

/** Where the end-to-end tests keep the files their database refers to: their own directory, never the development one. */
export const TEST_ASSET_DIR = process.env.TEST_ASSET_DIR ?? join(".data", "assets-test");

/** Where the tests put the DNS answers the test server reads (one file per name). Recreated with the database. */
export const TEST_DNS_DIR = process.env.TEST_DNS_DIR ?? join(".data", "dns-test");

/**
 * Empty a LOCAL asset directory, because the database that referred to its files is being recreated (a rebuilt database must not find
 * files that belong to rows it no longer has, and a seeded one must not refer to files that are missing). Refuses any directory outside
 * the repository's `.data/`, so a stray setting can never point this at something else.
 */
export async function clearLocalAssetDirectory(directory: string): Promise<void> {
  const inside = relative(resolve(".data"), resolve(directory));
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`Refusing to clear ${directory}: only directories inside .data/ are cleared.`);
  await rm(resolve(directory), { recursive: true, force: true });
}

/** The restricted runtime role's name is fixed: the migrations grant privileges to it by name. */
export const APP_ROLE = "climvia_app";

/** Load `.env` for scripts started without `--env-file` (Node can do this itself, no package needed). */
export function loadEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

/** The same server and credentials, a different database. */
export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

export const adminUrl = (database?: string) => (database ? withDatabase(requireEnv("DATABASE_ADMIN_URL"), database) : requireEnv("DATABASE_ADMIN_URL"));
export const appUrl = (database?: string) => (database ? withDatabase(requireEnv("DATABASE_URL"), database) : requireEnv("DATABASE_URL"));

export function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
}

export function adminDb(connectionString = adminUrl()) {
  const pool = new Pool({ connectionString, max: 4, application_name: "climvia-admin" });
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * Whether the runtime role is already exactly what provisioning would make it: it exists, it can log in and nothing else, and THIS password opens a session
 * on this database. A role belongs to the whole server, not to a database, so changing one is a write to the server's catalog; databases migrated at the
 * same moment (the end-to-end tests make several at once) must not all rewrite the same role, which PostgreSQL answers with "tuple concurrently updated".
 */
async function runtimeRoleIsAsProvisioned(pool: Pool, password: string): Promise<boolean> {
  const base = (pool as unknown as { options?: { connectionString?: string } }).options?.connectionString;
  if (!base) return false;
  const attributes = await pool.query<{ ok: boolean }>(
    "select (rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) as ok from pg_roles where rolname = $1",
    [APP_ROLE],
  );
  if (attributes.rows[0]?.ok !== true) return false;
  const url = new URL(base);
  url.username = APP_ROLE;
  url.password = password;
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Create the runtime role if it is missing, and set its password either way, so a changed POSTGRES_APP_PASSWORD takes
 * effect on the next migrate (a role that already has this password and these attributes is left alone). The role can log in and nothing else: no superuser,
 * no CREATEDB / CREATEROLE, no BYPASSRLS, which is what keeps Row Level Security binding on the application.
 */
export async function provisionRuntimeRole(pool: Pool, password: string): Promise<void> {
  if (password.length < 12) throw new Error("POSTGRES_APP_PASSWORD must be at least 12 characters.");
  if (await runtimeRoleIsAsProvisioned(pool, password)) return;
  const exists = await pool.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
  const verb = exists.rowCount ? "ALTER" : "CREATE";
  // format(%I / %L) quotes the identifier and the password literal on the server: no string building here.
  const { rows } = await pool.query<{ statement: string }>(
    `select format('${verb} ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) as statement`,
    [APP_ROLE, password],
  );
  await pool.query(rows[0].statement);
}

/** Provision the runtime role, then apply every pending migration in ./drizzle. Safe to run repeatedly. */
export async function migrateDatabase(connectionString: string, appPassword: string): Promise<void> {
  const { pool, db } = adminDb(connectionString);
  try {
    await provisionRuntimeRole(pool, appPassword);
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

/** Drop and recreate a database (the connection is made to the maintenance database `postgres`). */
export async function recreateDatabase(name: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Refusing to recreate a database named "${name}".`);
  const pool = new Pool({ connectionString: adminUrl("postgres"), max: 1 });
  try {
    // WITH (FORCE) disconnects anything still attached, such as a dev server that was left running.
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await pool.query(`CREATE DATABASE "${name}"`);
  } finally {
    await pool.end();
  }
}

export async function ensureDatabase(name: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Refusing to create a database named "${name}".`);
  const pool = new Pool({ connectionString: adminUrl("postgres"), max: 1 });
  try {
    const exists = await pool.query("select 1 from pg_database where datname = $1", [name]);
    if (!exists.rowCount) await pool.query(`CREATE DATABASE "${name}"`);
  } finally {
    await pool.end();
  }
}

/**
 * Wait until the database server accepts connections, retrying with a growing pause, for at most `seconds` (DB_WAIT_SECONDS, default 120).
 * A deployment starts PostgreSQL and the migration at about the same time, and a slow first start (or a restart) must not fail the deploy:
 * the container healthcheck says the server is up, and this covers the gap between "up" and "accepting this role". A wrong password or a
 * missing role is NOT retried for long: the server answered, so the answer is final and the command fails with it.
 */
export async function waitForDatabase(connectionString: string, seconds = Number(process.env.DB_WAIT_SECONDS ?? 120)): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  let pause = 500;
  for (let attempt = 1; ; attempt += 1) {
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
    try {
      await pool.query("select 1");
      if (attempt > 1) console.log(`The database answered after ${attempt} attempts.`);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      // 28xxx: authentication/authorization failed; 3D000: no such database. The server is there; waiting will not change the answer.
      if (/^(28|3D)/.test(code)) throw error;
      if (Date.now() + pause > deadline) throw new Error(`The database did not become reachable within ${seconds} seconds (${code || (error as Error).message}).`);
      console.log(`Waiting for the database (attempt ${attempt}: ${code || (error as Error).message})...`);
      await new Promise((resolve) => setTimeout(resolve, pause));
      pause = Math.min(pause * 2, 5000);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}
