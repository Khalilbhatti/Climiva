/**
 * Phase 19C, the database: how a customer's review is collected through a link, how the platform hides and restores a public review, and what the one
 * public predicate does to a provider's rating each time.
 *
 * Everything is SQL as the restricted runtime role (`climvia_app`, the one the application connects as) with a verified user id in `app.user_id`, or as
 * the owner where a test looks underneath. No browser. Each test makes its own provider, so the ratings asserted are exact.
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { hashReviewToken, newReviewToken, REVIEW_TOKEN_PATTERN } from "../src/lib/review-link";
import { makeProvider } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { asTenant, data, makeCustomer, makeReviewRequest, publicRating, publicReviewTexts } from "./review-helpers";

let owner: ReturnType<typeof adminDb>;
let app: Pool;
test.beforeAll(() => {
  owner = adminDb();
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
});
test.afterAll(async () => {
  await app.end();
  await owner.pool.end();
});

const handles = () => ({ db: owner.db, pool: owner.pool });
type Outcome = { result: string; public?: boolean };
const lookup = (token: string) => app.query<{ link: Record<string, unknown> | null }>("select app_public_review_request($1) as link", [token]).then((r) => r.rows[0].link);
const submit = (token: string, rating: number | null, text: string | null, showPublicly: boolean | null) =>
  app.query<{ outcome: Outcome }>("select app_public_submit_review($1, $2, $3, $4) as outcome", [token, rating, text, showPublicly]).then((r) => r.rows[0].outcome);
const refused = (promise: Promise<unknown>, code = "42501") => expect(promise).rejects.toMatchObject({ code });

/* ───────────────────────────── the definitions ───────────────────────────── */

test.describe("the review functions are narrow, and the tables stay closed", () => {
  test("every new function is SECURITY DEFINER with a fixed search path, executable by the application's role and nobody else; the hash helper is not executable at all", async () => {
    const rows = (
      await owner.pool.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; acl: string[] | null }>(
        `select proname, prosecdef, proconfig, proacl::text[] as acl from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by proname`,
        [[
          "app_public_review_request",
          "app_public_submit_review",
          "app_reissue_review_link",
          "app_hidden_review_ids",
          "app_listing_suspension",
          "app_request_listing_review",
          "app_platform_update_listing_message",
          "app_platform_keep_listing_suspended",
          "app_platform_set_review_moderation",
          "app_review_is_public",
          "app_review_token_hash",
        ]],
      )
    ).rows;
    expect(rows.map((row) => row.proname)).toHaveLength(11);
    for (const row of rows) {
      if (row.proname === "app_review_token_hash") {
        // Internal: hashing is the database's, and the application never calls it (it hashes in Node, the same way).
        expect(row.prosecdef, row.proname).toBe(false);
        expect((row.acl ?? []).filter((entry) => entry.startsWith("climvia_app=") || entry.startsWith("=")), row.proname).toEqual([]);
        continue;
      }
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.proconfig?.join(","), row.proname).toContain("search_path=public, pg_temp");
      expect((row.acl ?? []).some((entry) => entry.startsWith("=")), `${row.proname} is not open to PUBLIC`).toBe(false);
      expect((row.acl ?? []).some((entry) => entry.startsWith("climvia_app=X")), `${row.proname} is executable by the runtime role`).toBe(true);
    }
  });

  test("the runtime role can neither write a review nor change a request, and has no privilege at all on the review moderation table", async () => {
    const provider = await makeProvider("p19rdef", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const as = (userId: string, work: Parameters<typeof asTenant>[3]) => asTenant(app, userId, provider.business.organizationId, work);

    for (const person of [provider.business.owner, provider.business.admin]) {
      await refused(as(person.userId, (client) => client.query("insert into reviews (organization_id, slug, customer_id, source, rating, review_text, submitted_on, visibility) values ($1, 'forged', $2, 'Climvia', 5, 'Great', '2030-01-01', 'public')", [provider.business.organizationId, customer.id])));
      await refused(as(person.userId, (client) => client.query("update review_requests set status = 'completed', completed_at = now() where id = $1", [request.id])));
      await refused(as(person.userId, (client) => client.query("update review_requests set token_hash = $2 where id = $1", [request.id, hashReviewToken(newReviewToken())])));
      await refused(as(person.userId, (client) => client.query("select * from platform_review_moderation")));
      await refused(as(person.userId, (client) => client.query("insert into platform_review_moderation (review_id, state, decided_by) values (gen_random_uuid(), 'hidden', 'x')")));
    }
    for (const privilege of ["select", "insert", "update", "delete", "truncate"]) {
      expect((await owner.pool.query("select has_table_privilege('climvia_app', 'platform_review_moderation', $1) as allowed", [privilege])).rows[0].allowed, privilege).toBe(false);
      expect((await owner.pool.query("select has_table_privilege('climvia_app', 'reviews', $1) as allowed", [privilege])).rows[0].allowed, `reviews ${privilege}`).toBe(privilege === "select");
    }
    // No UPDATE of any column of a request.
    expect((await owner.pool.query("select count(*)::int as n from information_schema.column_privileges where grantee = 'climvia_app' and table_name = 'review_requests' and privilege_type = 'UPDATE'")).rows[0].n).toBe(0);
  });

  test("the schema holds a request's link to its shape: a hash is 64 lowercase hex characters and always has an expiry; completion and its time go together", async () => {
    const provider = await makeProvider("p19rshape", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const base = [provider.business.organizationId, customer.id];
    const insert = (hash: string | null, expires: string | null, status = "recorded", completed: string | null = null) =>
      owner.pool.query("insert into review_requests (organization_id, customer_id, channel, message, status, requested_at, token_hash, expires_at, completed_at) values ($1, $2, 'email', 'x', $3, now(), $4, $5, $6)", [...base, status, hash, expires, completed]);
    const good = hashReviewToken(newReviewToken());
    await expect(insert("ABC", "2030-01-01")).rejects.toMatchObject({ code: "23514", constraint: "review_requests_token_shape" });
    await expect(insert(good.toUpperCase(), "2030-01-01")).rejects.toMatchObject({ code: "23514", constraint: "review_requests_token_shape" });
    await expect(insert(good, null)).rejects.toMatchObject({ code: "23514", constraint: "review_requests_token_shape" });
    await expect(insert(null, null, "completed", null)).rejects.toMatchObject({ code: "23514", constraint: "review_requests_completion" });
    await expect(insert(null, null, "recorded", "2030-01-01")).rejects.toMatchObject({ code: "23514", constraint: "review_requests_completion" });
    await insert(good, "2030-01-01");
    // A secret is stored once: the same hash twice is a collision, not a second link.
    await expect(insert(good, "2030-01-01")).rejects.toMatchObject({ code: "23505", constraint: "review_requests_token_hash_unique" });
  });
});

/* ───────────────────────────── the customer's side ───────────────────────────── */

test.describe("a visitor who holds a link", () => {
  test("a token is 43 URL-safe characters and its hash is the one the database computes", async () => {
    for (let index = 0; index < 20; index += 1) {
      const token = newReviewToken();
      expect(token).toMatch(REVIEW_TOKEN_PATTERN);
      expect((await owner.pool.query("select app_review_token_hash($1) as hash", [token])).rows[0].hash).toBe(hashReviewToken(token));
    }
    expect(new Set(Array.from({ length: 200 }, () => newReviewToken())).size).toBe(200);
  });

  test("sees only whether the link works, the business and the name the review would be shown under; a wrong, unknown or malformed secret is the same nothing", async () => {
    const provider = await makeProvider("p19rlook", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Sarah Mitchell");
    const open = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const link = await lookup(open.token);
    expect(link).toEqual({ state: "open", business: provider.name, displayName: "Sarah M." });
    // Nothing that names a record: no id, no customer, no Job, no organization.
    expect(JSON.stringify(link)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(JSON.stringify(link)).not.toContain(customer.slug);

    const expired = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id, { expiresIn: "-1 hour" });
    expect(await lookup(expired.token)).toEqual({ state: "expired", business: provider.name });

    for (const secret of [newReviewToken(), "", "short", `${newReviewToken()}x`, newReviewToken().slice(1), "a".repeat(43).replace(/a/g, "="), open.hash, `${open.token} `, open.token.toUpperCase().replace(/[^A-Z0-9]/g, "A").padEnd(43, "A").slice(0, 43)]) {
      expect(await lookup(secret), JSON.stringify(secret)).toBeNull();
    }
    // SQL injection is not a lookup either.
    expect(await lookup("' or 1=1 --".padEnd(43, "a"))).toBeNull();
  });

  test("writes the review a link asked for: the customer, the business, the Job and the date come from the request, and the words are the customer's", async () => {
    const provider = await makeProvider("p19rsend", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, "Sarah Mitchell");
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);

    const outcome = await submit(request.token, 4, "  They arrived on time and fixed it.  ", true);
    expect(outcome).toEqual({ result: "submitted", public: true });
    const review = (await owner.pool.query("select *, submitted_on::text as submitted_text from reviews where request_id = $1", [request.id])).rows;
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ organization_id: provider.business.organizationId, customer_id: customer.id, contact_name: null, job_id: null, source: "Climvia", rating: 4, review_text: "They arrived on time and fixed it.", visibility: "public", imported: false });
    expect(review[0].made_public_at).not.toBeNull();
    // The date is the business's calendar day (its time zone), not the server's.
    const today = (await owner.pool.query("select (now() at time zone o.timezone)::date::text as today from organizations o where o.id = $1", [provider.business.organizationId])).rows[0].today;
    expect(review[0].submitted_text).toBe(today);

    const closed = (await owner.pool.query("select status, completed_at from review_requests where id = $1", [request.id])).rows[0];
    expect(closed.status).toBe("completed");
    expect(closed.completed_at).not.toBeNull();
    // Used once: the link now says so, and a second submission finds the first.
    expect(await lookup(request.token)).toEqual({ state: "completed", business: provider.name });
    expect(await submit(request.token, 1, "Again", true)).toEqual({ result: "completed" });
    expect((await owner.pool.query("select count(*)::int as n from reviews where organization_id = $1", [provider.business.organizationId])).rows[0].n).toBe(1);
  });

  test("a review is public ONLY when the customer says yes: no, nothing and anything else are private", async () => {
    const provider = await makeProvider("p19rconsent", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const outcomes: [boolean | null, string][] = [[false, "private"], [null, "private"], [true, "public"]];
    for (const [consent, visibility] of outcomes) {
      const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
      await submit(request.token, 5, `Consent ${String(consent)}`, consent);
      const row = (await owner.pool.query("select visibility, made_public_at from reviews where request_id = $1", [request.id])).rows[0];
      expect(row.visibility, String(consent)).toBe(visibility);
      expect(row.made_public_at === null, String(consent)).toBe(visibility === "private");
    }
  });

  test("content outside the rules is an error and writes nothing; a link that ran out writes nothing", async () => {
    const provider = await makeProvider("p19rbad", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    for (const [rating, text] of [[0, "x"], [6, "x"], [null, "x"], [3, ""], [3, "   "], [3, null], [3, "x".repeat(2001)]] as [number | null, string | null][]) {
      await expect(submit(request.token, rating, text, true), `${rating} ${String(text).slice(0, 8)}`).rejects.toMatchObject({ code: "22023" });
    }
    expect((await owner.pool.query("select count(*)::int as n from reviews where organization_id = $1", [provider.business.organizationId])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select status from review_requests where id = $1", [request.id])).rows[0].status).toBe("recorded");
    // 2000 characters is the limit and is accepted.
    expect(await submit(request.token, 3, "x".repeat(2000), false)).toEqual({ result: "submitted", public: false });

    const old = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id, { expiresIn: "-1 second" });
    expect(await submit(old.token, 5, "Too late", true)).toEqual({ result: "expired" });
    expect(await submit(newReviewToken(), 5, "Nobody's", true)).toEqual({ result: "invalid" });
    expect(await submit("not a token", 5, "Nobody's", true)).toEqual({ result: "invalid" });
    expect((await owner.pool.query("select count(*)::int as n from reviews where organization_id = $1", [provider.business.organizationId])).rows[0].n).toBe(1);
  });

  test("a link writes only into its own business: another business's customer, Job and listing are not reachable through it", async () => {
    const mine = await makeProvider("p19rcross-a", handles());
    const theirs = await makeProvider("p19rcross-b", handles());
    const myCustomer = await makeCustomer(owner.pool, mine.business.organizationId, "Maya Singh");
    await makeCustomer(owner.pool, theirs.business.organizationId, "Other Person");
    const request = await makeReviewRequest(owner.pool, mine.business.organizationId, myCustomer.id);
    await submit(request.token, 5, "Mine", true);
    expect((await owner.pool.query("select count(*)::int as n from reviews where organization_id = $1", [theirs.business.organizationId])).rows[0].n).toBe(0);
    expect(await publicRating(owner.pool, theirs.slug)).toBeNull();
    expect(await publicRating(owner.pool, mine.slug)).toEqual({ average: 5, count: 1 });
    // The database also refuses a review that names another business's customer, whoever writes it.
    // (A request nobody has answered yet, so no unique key fires before the foreign key does.)
    const foreign = await makeCustomer(owner.pool, theirs.business.organizationId);
    const fresh = await makeReviewRequest(owner.pool, mine.business.organizationId, myCustomer.id);
    await expect(
      owner.pool.query("insert into reviews (organization_id, slug, customer_id, source, rating, review_text, submitted_on, request_id) values ($1, 'forged-cross', $2, 'Climvia', 5, 'x', '2030-01-01', $3)", [mine.business.organizationId, foreign.id, fresh.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  test("ten people opening the same link at once write exactly one review", async () => {
    const provider = await makeProvider("p19rrace", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) => submit(request.token, 5, `Race ${index}`, true)));
    expect(outcomes.filter((outcome) => outcome.result === "submitted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.result === "completed")).toHaveLength(9);
    expect((await owner.pool.query("select count(*)::int as n from reviews where organization_id = $1", [provider.business.organizationId])).rows[0].n).toBe(1);
  });
});

/* ───────────────────────────── the business's side ───────────────────────────── */

test.describe("the business replaces a link", () => {
  test("an owner or an admin can; the old secret stops working at once and the new one works", async () => {
    const provider = await makeProvider("p19rre", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id, { expiresIn: "-1 day" });
    expect((await lookup(request.token))?.state).toBe("expired");

    for (const person of [provider.business.owner, provider.business.admin]) {
      const next = newReviewToken();
      const result = await asTenant(
        app,
        person.userId,
        provider.business.organizationId,
        (client) => data<{ found: boolean; changed: boolean }>(client, "select app_reissue_review_link($1, $2, now() + interval '30 days') as data", [request.id, hashReviewToken(next)]),
        { commit: true },
      );
      expect(result).toEqual({ found: true, changed: true });
      expect((await lookup(next))?.state).toBe("open");
      expect(await lookup(request.token)).toBeNull();
      request.token = next;
    }
  });

  test("a member, someone with no business, another business's owner and a signed-out caller cannot, and a forged hash or lifetime is refused", async () => {
    const provider = await makeProvider("p19rreb", handles());
    const stranger = await makeProvider("p19rrec", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    const call = (userId: string | null, organizationId: string | null, hash = hashReviewToken(newReviewToken()), expires = "30 days") =>
      asTenant(app, userId, organizationId, (client) => client.query("select app_reissue_review_link($1, $2, now() + $3::interval) as data", [request.id, hash, expires]));

    await refused(call(provider.business.member.userId, provider.business.organizationId));
    await refused(call(null, null));
    // The owner of ANOTHER business, naming this business's request: they are not a member of the organization they claim, so refused; and in their own
    // organization the request does not exist.
    await refused(call(stranger.business.owner.userId, provider.business.organizationId));
    const hidden = await asTenant(app, stranger.business.owner.userId, stranger.business.organizationId, (client) => data<{ found: boolean }>(client, "select app_reissue_review_link($1, $2, now() + interval '1 day') as data", [request.id, hashReviewToken(newReviewToken())]));
    expect(hidden.found).toBe(false);

    await refused(call(provider.business.owner.userId, provider.business.organizationId, "not-a-hash"), "22023");
    await refused(call(provider.business.owner.userId, provider.business.organizationId, hashReviewToken(newReviewToken()).toUpperCase()), "22023");
    await refused(call(provider.business.owner.userId, provider.business.organizationId, hashReviewToken(newReviewToken()), "-1 hour"), "22023");
    await refused(call(provider.business.owner.userId, provider.business.organizationId, hashReviewToken(newReviewToken()), "91 days"), "22023");
    // None of that changed the link.
    expect((await lookup(request.token))?.state).toBe("open");
  });

  test("an answered request has nothing left to ask for", async () => {
    const provider = await makeProvider("p19rred", handles());
    const customer = await makeCustomer(owner.pool, provider.business.organizationId);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    await submit(request.token, 5, "Thanks", false);
    const result = await asTenant(app, provider.business.owner.userId, provider.business.organizationId, (client) =>
      data<{ found: boolean; changed: boolean; reason?: string }>(client, "select app_reissue_review_link($1, $2, now() + interval '1 day') as data", [request.id, hashReviewToken(newReviewToken())]),
    );
    expect(result).toEqual({ found: true, changed: false, reason: "completed" });
  });
});

/* ───────────────────────────── moderation and the rating ───────────────────────────── */

test.describe("the platform's decision about a public review", () => {
  const rate = async (provider: Awaited<ReturnType<typeof makeProvider>>, rating: number, text: string, consent: boolean) => {
    const customer = await makeCustomer(owner.pool, provider.business.organizationId, `Reviewer ${randomBytes(2).toString("hex")}`);
    const request = await makeReviewRequest(owner.pool, provider.business.organizationId, customer.id);
    await submit(request.token, rating, text, consent);
    return (await owner.pool.query<{ id: string }>("select id from reviews where request_id = $1", [request.id])).rows[0].id;
  };
  const moderate = (userId: string | null, reviewId: string, state: string, reason: string | null = null) =>
    asTenant(app, userId, null, (client) => data<{ found: boolean; changed: boolean; state?: string; reason?: string }>(client, "select app_platform_set_review_moderation($1, $2, $3) as data", [reviewId, state, reason]), { commit: true });

  test("hiding and restoring change the profile's rating and count exactly, and nothing else about the review", async () => {
    const provider = await makeProvider("p19rmod", handles());
    const admin = await makePlatformAdmin("p19rmoda", owner.db, owner.pool);
    expect(await publicRating(owner.pool, provider.slug)).toBeNull();

    const five = await rate(provider, 5, "Five stars review", true);
    await rate(provider, 2, "Private two stars", false);
    const four = await rate(provider, 4, "Four stars review", true);
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 4.5, count: 2 });

    expect(await moderate(admin.userId, five, "hidden", "Contains a phone number")).toEqual({ found: true, changed: true, state: "hidden" });
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 4, count: 1 });
    expect(await publicReviewTexts(owner.pool, provider.slug)).toEqual(["Four stars review"]);
    // Nothing of the platform's reason is in what a visitor gets.
    expect(JSON.stringify((await owner.pool.query("select app_public_listing($1) as listing", [provider.slug])).rows[0].listing)).not.toContain("phone number");

    // The business's own record is untouched.
    const kept = (await owner.pool.query("select visibility, review_text, rating from reviews where id = $1", [five])).rows[0];
    expect(kept).toEqual({ visibility: "public", review_text: "Five stars review", rating: 5 });

    expect(await moderate(admin.userId, four, "hidden")).toMatchObject({ changed: true });
    expect(await publicRating(owner.pool, provider.slug)).toBeNull();
    expect(await publicReviewTexts(owner.pool, provider.slug)).toEqual([]);

    expect(await moderate(admin.userId, five, "visible")).toEqual({ found: true, changed: true, state: "visible" });
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 5, count: 1 });
    expect(await moderate(admin.userId, four, "visible")).toMatchObject({ changed: true });
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 4.5, count: 2 });

    // Restoring clears the internal reason; each decision is one audit event; deciding what it already is records nothing.
    expect((await owner.pool.query("select state, reason, revision from platform_review_moderation where review_id = $1", [five])).rows[0]).toEqual({ state: "visible", reason: null, revision: 2 });
    expect(await moderate(admin.userId, five, "visible")).toEqual({ found: true, changed: false, state: "visible" });
    const audit = (await owner.pool.query("select action, actor_kind, actor_user_id, target_kind, reason, metadata from platform_audit_events where target_id = $1 order by occurred_at, id", [five])).rows;
    expect(audit.map((row) => row.action)).toEqual(["review.hidden", "review.restored"]);
    expect(audit[0]).toMatchObject({ actor_kind: "platform_admin", actor_user_id: admin.userId, target_kind: "review", reason: "Contains a phone number" });
    expect(audit[0].metadata).toMatchObject({ organizationId: provider.business.organizationId, rating: 5 });
    expect(JSON.stringify(audit[0].metadata)).not.toContain("Five stars review");
  });

  test("a private review has nothing public to hide, and the decision is the platform's alone", async () => {
    const provider = await makeProvider("p19rmodb", handles());
    const admin = await makePlatformAdmin("p19rmodbadm", owner.db, owner.pool);
    const privateReview = await rate(provider, 3, "Private words", false);
    const publicReview = await rate(provider, 5, "Public words", true);
    expect(await moderate(admin.userId, privateReview, "hidden")).toEqual({ found: true, changed: false, state: "visible", reason: "not_public" });
    expect((await owner.pool.query("select count(*)::int as n from platform_review_moderation where review_id = $1", [privateReview])).rows[0].n).toBe(0);
    expect(await moderate(admin.userId, "00000000-0000-4000-8000-000000000000", "hidden")).toEqual({ found: false, changed: false });

    // Not an administrator: the business's owner, an ordinary person, and nobody.
    const ordinary = await makePlatformAdmin("p19rmodordinary", owner.db, owner.pool);
    await owner.pool.query("update platform_admins set revoked_at = now(), revoked_by = 'specs' where user_id = $1", [ordinary.userId]);
    for (const person of [provider.business.owner.userId, provider.business.admin.userId, ordinary.userId, null]) {
      await refused(moderate(person, publicReview, "hidden"));
    }
    await refused(moderate(admin.userId, publicReview, "deleted"), "22023");
    await refused(moderate(admin.userId, publicReview, "hidden", "x".repeat(501)), "22023");
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 5, count: 1 });
  });

  test("the business is told which of its reviews are hidden, and only its own (ids, never the reason)", async () => {
    const provider = await makeProvider("p19rmodc", handles());
    const other = await makeProvider("p19rmodd", handles());
    const admin = await makePlatformAdmin("p19rmodcadm", owner.db, owner.pool);
    const mine = await rate(provider, 5, "Mine", true);
    const theirs = await rate(other, 1, "Theirs", true);
    await moderate(admin.userId, mine, "hidden", "internal reason one");
    await moderate(admin.userId, theirs, "hidden", "internal reason two");

    const idsFor = (userId: string | null, organizationId: string | null) => asTenant(app, userId, organizationId, async (client) => (await client.query("select app_hidden_review_ids() as id")).rows.map((row) => row.id));
    expect(await idsFor(provider.business.member.userId, provider.business.organizationId)).toEqual([mine]);
    expect(await idsFor(other.business.owner.userId, other.business.organizationId)).toEqual([theirs]);
    // Claiming a business you are not in, or no identity at all, shows nothing.
    expect(await idsFor(other.business.owner.userId, provider.business.organizationId)).toEqual([]);
    expect(await idsFor(null, null)).toEqual([]);
  });

  test("the platform's reviews list shows the decision and whether the Marketplace counts each review, and can be filtered", async () => {
    const provider = await makeProvider("p19rmode", handles());
    const admin = await makePlatformAdmin("p19rmodeadm", owner.db, owner.pool);
    const shown = await rate(provider, 5, "Shown words", true);
    const hiddenOne = await rate(provider, 4, "Hidden words", true);
    const privateOne = await rate(provider, 3, "Private words", false);
    await moderate(admin.userId, hiddenOne, "hidden", "Because");
    const list = (visibility: string | null) =>
      asTenant(app, admin.userId, null, (client) =>
        data<{ total: number; rows: { id: string; eligible: boolean; visibility: string; moderation: { state: string; reason: string | null } }[] }>(client, "select app_platform_reviews($1, null, 100, 0, $2) as data", [provider.token, visibility]),
      );
    const all = await list(null);
    expect(all.total).toBe(3);
    const byId = new Map(all.rows.map((row) => [row.id, row]));
    expect(byId.get(shown)).toMatchObject({ eligible: true, visibility: "public", moderation: { state: "visible" } });
    expect(byId.get(hiddenOne)).toMatchObject({ eligible: false, visibility: "public", moderation: { state: "hidden", reason: "Because" } });
    expect(byId.get(privateOne)).toMatchObject({ eligible: false, visibility: "private" });
    expect((await list("public")).total).toBe(2);
    expect((await list("private")).rows.map((row) => row.id)).toEqual([privateOne]);
    expect((await list("hidden")).rows.map((row) => row.id)).toEqual([hiddenOne]);
    expect((await list("nonsense")).total).toBe(3);
    // The old four-argument call still works (the fifth argument is optional).
    expect((await asTenant(app, admin.userId, null, (client) => data<{ total: number }>(client, "select app_platform_reviews($1, null, 100, 0) as data", [provider.token]))).total).toBe(3);
  });

  test("a review that is not from Climvia, or not public, never counts, and the single predicate is the only place that says so", async () => {
    const provider = await makeProvider("p19rpred", handles(), { reviews: [{ rating: 5, text: "Seeded public", visibility: "public" }, { rating: 1, text: "Seeded private", visibility: "private" }] });
    expect(await publicRating(owner.pool, provider.slug)).toEqual({ average: 5, count: 1 });
    const admin = await makePlatformAdmin("p19rpredadm", owner.db, owner.pool);
    const id = (await owner.pool.query<{ id: string }>("select id from reviews where organization_id = $1 and review_text = 'Seeded public'", [provider.business.organizationId])).rows[0].id;
    await moderate(admin.userId, id, "hidden");
    expect(await publicRating(owner.pool, provider.slug)).toBeNull();
    // The search results use the same rule.
    const card = (await owner.pool.query("select app_public_marketplace_search($1::text[], null, null, null, null, 1, 12) as results", [[provider.token]])).rows[0].results;
    expect(card.results).toHaveLength(1);
    expect(card.results[0].rating ?? null).toBeNull();
    await moderate(admin.userId, id, "visible");
    const again = (await owner.pool.query("select app_public_marketplace_search($1::text[], null, null, null, null, 1, 12) as results", [[provider.token]])).rows[0].results;
    expect(Number(again.results[0].rating.average)).toBe(5);
    expect(Number(again.results[0].rating.count)).toBe(1);
  });
});
