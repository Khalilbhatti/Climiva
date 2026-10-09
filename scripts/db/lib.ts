/**
 * Shared by the db:* scripts. These run with the ADMIN (owner) connection: they create the schema, provision the
 * runtime role and seed data. The running application never uses it.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";

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
 * Create the runtime role if it is missing, and set its password either way, so a changed POSTGRES_APP_PASSWORD takes
 * effect on the next migrate. The role can log in and nothing else: no superuser, no CREATEDB / CREATEROLE, no
 * BYPASSRLS, which is what keeps Row Level Security binding on the application.
 */
export async function provisionRuntimeRole(pool: Pool, password: string): Promise<void> {
  if (password.length < 12) throw new Error("POSTGRES_APP_PASSWORD must be at least 12 characters.");
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
