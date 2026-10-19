/**
 * Shared by the platform-administration specs: people with and without platform authority, a Marketplace listing to moderate, the command-line
 * tool, and requests with a chosen session. (Not a spec: a helper exported from a `*.spec.ts` would register that file's tests again where it is imported.)
 *
 * Granting platform authority here is the owner-role SQL the command-line tool runs (platform-admin-cli.spec.ts runs the tool itself); no browser or
 * API path writes it, which is the point of the specs that use this.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Pool } from "pg";
import { adminDb, adminUrl, withDatabase } from "../scripts/db/lib";
import { ensureMembership, ensureUser, seedAuth } from "../scripts/db/seed-lib";

/** The password the seed gives every account it makes (what signedIn() signs in with). */
const PASSWORD = process.env.SEED_PASSWORD ?? "";

type Db = ReturnType<typeof adminDb>["db"];

export type Account = { userId: string; email: string; password: string };

/** A person with an account and no business: what someone is the moment they sign up. */
export async function makeAccount(label: string, db: Db, database?: string): Promise<Account> {
  const suffix = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const email = `${label}-${suffix}@example.test`;
  const { auth, close } = seedAuth(database);
  try {
    const userId = await ensureUser(auth, db, { email, name: `${label[0].toUpperCase()}${label.slice(1)} ${suffix}` }, PASSWORD);
    return { userId, email, password: PASSWORD };
  } finally {
    await close();
  }
}

/** Put a person in a business with a role. */
export async function joinBusiness(db: Db, organizationId: string, userId: string, role: "owner" | "admin" | "member"): Promise<void> {
  await ensureMembership(db, { organizationId, userId, role });
}

/** What the command-line tool does for `grant`, without the process: an assignment row (and its record) written as the owner. */
export async function grantPlatformAdmin(pool: Pool, userId: string): Promise<void> {
  await pool.query("insert into platform_admins (user_id, role, granted_via, granted_by) values ($1, 'super_admin', 'cli', 'cli:specs')", [userId]);
}

export async function revokePlatformAdmin(pool: Pool, userId: string): Promise<void> {
  await pool.query("update platform_admins set revoked_at = now(), revoked_by = 'cli:specs' where user_id = $1 and revoked_at is null", [userId]);
}

/** A person with platform authority and, optionally, a business of their own. */
export async function makePlatformAdmin(label: string, db: Db, pool: Pool, database?: string): Promise<Account> {
  const account = await makeAccount(label, db, database);
  await grantPlatformAdmin(pool, account.userId);
  return account;
}

export type TestListing = { id: string; slug: string };

/** A Marketplace listing for a business, in the status given (the business's own choice). */
export async function makeListing(pool: Pool, organizationId: string, status: "draft" | "published" | "hidden" = "published"): Promise<TestListing> {
  const slug = `listing-${randomBytes(4).toString("hex")}`;
  const inserted = await pool.query<{ id: string }>(
    "insert into marketplace_listings (organization_id, public_slug, status, description, published_at) values ($1, $2, $3, 'Heating and cooling for the neighborhood.', case when $3 = 'draft' then null else now() end) returning id",
    [organizationId, slug, status],
  );
  return { id: inserted.rows[0].id, slug };
}

/** The command-line tool, as an operator runs it (tsx directly, with no shell between: an address with quotes or a % reaches the tool as typed). */
export function runTool(script: "grant" | "revoke" | "list", args: string[], env: Record<string, string> = {}): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("scripts", "platform-admin", `${script}.ts`), ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Every console address a signed-in person could try. */
export const CONSOLE_PATHS = ["/platform-admin", "/platform-admin/organizations", "/platform-admin/users", "/platform-admin/marketplace", "/platform-admin/reviews", "/platform-admin/system"] as const;

export { adminUrl, withDatabase };
