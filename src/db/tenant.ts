/**
 * Row Level Security context: how a verified identity reaches PostgreSQL.
 *
 * Every query on organization-owned data runs through `withTenant` (or `withUser` for a person's own data). Each opens
 * a transaction and sets two TRANSACTION-LOCAL settings before anything else:
 *
 *     app.user_id   the authenticated user, from the validated Better Auth session
 *     app.org_id    the active organization, from a membership that was just verified
 *
 * The RLS policies (drizzle/0001_rls_policies_and_grants.sql) read them. Why a client cannot impersonate anyone:
 *
 *  1. The values come from server code that has already verified the session cookie and the membership. They are
 *     never read from a request body, query string, header or client storage.
 *  2. They are set with `set_config(name, value, true)`: bound parameters (no string building), local to this
 *     transaction, gone at COMMIT/ROLLBACK, so a pooled connection cannot carry one request's identity into another.
 *  3. The policies do not just trust `app.org_id`. They also look the user up in `organization_memberships`, so a bug that
 *     passes the wrong organization id still returns no rows.
 *
 * With no context (plain `getDb()` on a tenant table) the policies are all false: the result is empty, never someone
 * else's data.
 */
import { sql } from "drizzle-orm";
import { getDb, type Database, type Tx } from "./index";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export type TenantContext = { userId: string; organizationId: string };

function assertUserId(userId: string) {
  // Better Auth ids are opaque strings; refuse the empty one so "no user" can never look like a user.
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) throw new Error("A user id is required.");
}

/** Run `fn` as `userId` with no organization selected, on an explicit connection (scripts, tests and auth hooks). */
export async function runAsUser<T>(db: Database, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUserId(userId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true), set_config('app.org_id', '', true)`);
    return fn(tx);
  });
}

/** Run `fn` as `userId` inside organization `organizationId` on an explicit connection. */
export async function runAsTenant<T>(db: Database, context: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUserId(context.userId);
  if (!isUuid(context.organizationId)) throw new Error("A valid organization id is required.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${context.userId}, true), set_config('app.org_id', ${context.organizationId}, true)`);
    return fn(tx);
  });
}

/** Run `fn` as `userId` with no organization selected: the person's own profile and the list of their workspaces. */
export const withUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => runAsUser(getDb(), userId, fn);

/** Run `fn` as `userId` inside organization `organizationId`. The caller must already have verified the membership. */
export const withTenant = <T>(context: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> => runAsTenant(getDb(), context, fn);

/** Inside a `withUser` transaction, point it at an organization (used once, when onboarding has just created one). */
export async function selectOrganization(tx: Tx, organizationId: string): Promise<void> {
  if (!isUuid(organizationId)) throw new Error("A valid organization id is required.");
  await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
}
