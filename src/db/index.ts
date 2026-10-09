/**
 * The one database connection the application uses.
 *
 * - It connects as the restricted runtime role (`DATABASE_URL`, role `climvia_app`): not a superuser, not the table
 *   owner, so Row Level Security applies to every query made through it. Migrations and seeds use a different
 *   connection (`DATABASE_ADMIN_URL`) that the running app never has.
 * - It is created lazily, once per server process, and shared (a connection pool, not one connection per request or
 *   per render). `next dev` reloads modules, so the pool is parked on `globalThis` to survive that.
 * - It is server code. Nothing under `src/db` may be imported by a Client Component; `pg` does not run in a browser and
 *   a test (e2e/server-boundary.spec.ts) fails if a "use client" file reaches it.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** What a transaction callback receives: the same query builder, bound to one transaction. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { climviaPool?: Pool; climviaDb?: Database };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

export function getPool(): Pool {
  if (!globalForDb.climviaPool) {
    globalForDb.climviaPool = new Pool({
      connectionString: requiredEnv("DATABASE_URL"),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "climvia-app",
    });
    // An idle client erroring (the server restarted) must not crash the process; the pool replaces it.
    globalForDb.climviaPool.on("error", (error) => console.error("[db] idle client error:", error.message));
  }
  return globalForDb.climviaPool;
}

export function getDb(): Database {
  if (!globalForDb.climviaDb) globalForDb.climviaDb = drizzle(getPool(), { schema });
  return globalForDb.climviaDb;
}

export * as schema from "./schema";
