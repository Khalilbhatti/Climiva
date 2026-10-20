/**
 * Shared by the Phase 19C specs for review collection, review moderation and the suspension lifecycle. (Not a spec: a helper exported from a `*.spec.ts`
 * would register that file's tests again where it is imported.)
 *
 * Everything that makes a request or a link here goes through the same two functions the application uses (`newReviewToken`, `hashReviewToken`), so a test
 * can hold a link's secret the way the business is shown it once, while the database holds only its hash.
 */
import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashReviewToken, newReviewToken } from "../src/lib/review-link";

export type TestCustomer = { id: string; slug: string; name: string };

/** A customer of a business (written as the owner). */
export async function makeCustomer(pool: Pool, organizationId: string, name = "Sarah Mitchell"): Promise<TestCustomer> {
  const slug = `cust-${randomBytes(4).toString("hex")}`;
  const inserted = await pool.query<{ id: string }>("insert into customers (organization_id, slug, name, phone, email) values ($1, $2, $3, '555-0100', $4) returning id", [organizationId, slug, name, `${slug}@example.test`]);
  return { id: inserted.rows[0].id, slug, name };
}

export type TestRequest = { id: string; token: string; hash: string };

/** A review request with a link the test holds (as the business is shown it once). `expiresIn` is a PostgreSQL interval, `-1 hour` for one that ran out. */
export async function makeReviewRequest(pool: Pool, organizationId: string, customerId: string, options: { expiresIn?: string; withLink?: boolean } = {}): Promise<TestRequest> {
  const token = newReviewToken();
  const hash = hashReviewToken(token);
  const withLink = options.withLink ?? true;
  const inserted = await pool.query<{ id: string }>(
    `insert into review_requests (organization_id, customer_id, channel, message, status, requested_at, token_hash, expires_at)
     values ($1, $2, 'email', 'Please review our work.', 'recorded', now(), $3, case when $3::text is null then null else now() + $4::interval end) returning id`,
    [organizationId, customerId, withLink ? hash : null, options.expiresIn ?? "30 days"],
  );
  return { id: inserted.rows[0].id, token, hash };
}

/** What a visitor's profile says about a provider's rating, through the public function (the number a visitor sees). */
export async function publicRating(pool: Pool, slug: string): Promise<{ average: number; count: number } | null> {
  const result = await pool.query<{ listing: { rating: { average: number | string; count: number } | null } | null }>("select app_public_listing($1) as listing", [slug]);
  const rating = result.rows[0]?.listing?.rating;
  return rating ? { average: Number(rating.average), count: Number(rating.count) } : null;
}

/** The reviews a visitor's profile shows (their words), newest first. */
export async function publicReviewTexts(pool: Pool, slug: string): Promise<string[]> {
  const result = await pool.query<{ listing: { reviews: { text: string }[] } | null }>("select app_public_listing($1) as listing", [slug]);
  return (result.rows[0]?.listing?.reviews ?? []).map((review) => review.text);
}

/** Run `work` as the application's runtime role with `userId` as the verified person and `organizationId` as the active business, in a transaction rolled back unless `commit`. */
export async function asTenant<T>(app: Pool, userId: string | null, organizationId: string | null, work: (client: PoolClient) => Promise<T>, options: { commit?: boolean } = {}): Promise<T> {
  const client = await app.connect();
  try {
    await client.query("begin");
    if (userId !== null) await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId, organizationId ?? ""]);
    const result = await work(client);
    await client.query(options.commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const data = async <T = Record<string, unknown>>(client: PoolClient, statement: string, values: unknown[] = []): Promise<T> => (await client.query(statement, values)).rows[0].data as T;
