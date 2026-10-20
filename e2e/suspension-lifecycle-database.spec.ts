/**
 * Phase 19C, the database: a suspended listing, what the business may be told about it, its request for a second look, and the platform's answers.
 *
 * SQL as the restricted runtime role (`climvia_app`) with a verified user id and active organization in the transaction-local settings, exactly as the
 * server sets them, or as the owner where a test looks underneath. No browser. Each test makes its own provider and its own administrator.
 */
import { Pool } from "pg";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { makeProvider } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { asTenant, data } from "./review-helpers";

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
type Provider = Awaited<ReturnType<typeof makeProvider>>;
type Outcome = { found?: boolean; changed: boolean; state?: string; reviewState?: string; result?: string; retryAfter?: string };
const refused = (promise: Promise<unknown>, code = "42501") => expect(promise).rejects.toMatchObject({ code });

/** The platform decides about a listing (committed), as an administrator. */
const decide = (adminId: string | null, listingId: string, state: string, reason: string | null, message?: string | null) =>
  asTenant(app, adminId, null, (client) => (message === undefined ? data<Outcome>(client, "select app_platform_set_listing_moderation($1, $2, $3) as data", [listingId, state, reason]) : data<Outcome>(client, "select app_platform_set_listing_moderation($1, $2, $3, $4) as data", [listingId, state, reason, message])), { commit: true });
const editMessage = (adminId: string | null, listingId: string, message: string | null) =>
  asTenant(app, adminId, null, (client) => data<Outcome>(client, "select app_platform_update_listing_message($1, $2) as data", [listingId, message]), { commit: true });
const keep = (adminId: string | null, listingId: string, message: string | null) =>
  asTenant(app, adminId, null, (client) => data<Outcome>(client, "select app_platform_keep_listing_suspended($1, $2) as data", [listingId, message]), { commit: true });
const ask = (userId: string | null, organizationId: string | null, note: string | null) =>
  asTenant(app, userId, organizationId, (client) => data<Outcome>(client, "select app_request_listing_review($1) as data", [note]), { commit: true });
const suspensionOf = (userId: string | null, organizationId: string | null) => asTenant(app, userId, organizationId, async (client) => (await client.query("select app_listing_suspension() as data")).rows[0].data as Record<string, unknown> | null);
const moderationRow = async (listingId: string) => (await owner.pool.query("select * from platform_listing_moderation where listing_id = $1", [listingId])).rows[0];
const audit = async (listingId: string) => (await owner.pool.query("select action, actor_kind, actor_user_id, reason, metadata from platform_audit_events where target_id = $1 order by occurred_at, id", [listingId])).rows;
const visible = async (provider: Provider) => (await owner.pool.query("select app_public_listing($1) is not null as shown", [provider.slug])).rows[0].shown as boolean;
const found = async (provider: Provider) => (await owner.pool.query("select jsonb_array_length(app_public_marketplace_search($1::text[], null, null, null, null, 1, 12)->'results') as n", [[provider.token]])).rows[0].n as number;

test.describe("what a business is told about a suspension", () => {
  test("the message written for it, when it began and where its request stands: never the internal reason, who decided or the audit trail", async () => {
    const provider = await makeProvider("p19sus", handles());
    const stranger = await makeProvider("p19susb", handles());
    const admin = await makePlatformAdmin("p19susadm", owner.db, owner.pool);
    expect(await visible(provider)).toBe(true);
    expect(await found(provider)).toBe(1);
    expect(await suspensionOf(provider.business.owner.userId, provider.business.organizationId)).toBeNull();

    expect(await decide(admin.userId, provider.listingId, "suspended", "INTERNAL-ONLY: complaint 4471, see ops notes", "Your listing names services you do not offer. Remove them and ask for a review.")).toEqual({ found: true, changed: true, state: "suspended" });
    expect(await visible(provider)).toBe(false);
    expect(await found(provider)).toBe(0);

    // Every member of the business can read it, in exactly this shape.
    for (const person of [provider.business.owner, provider.business.admin, provider.business.member]) {
      const told = await suspensionOf(person.userId, provider.business.organizationId);
      expect(told, person.email).toMatchObject({ message: "Your listing names services you do not offer. Remove them and ask for a review.", reviewState: "none", reviewRequestedAt: null, reviewNote: null, reviewResolvedAt: null, reviewOutcome: null });
      expect(typeof told?.suspendedAt).toBe("string");
      expect(Object.keys(told!).sort()).toEqual(["message", "reviewNote", "reviewOutcome", "reviewRequestedAt", "reviewResolvedAt", "reviewState", "suspendedAt"]);
      expect(JSON.stringify(told)).not.toMatch(/INTERNAL-ONLY|complaint|4471|decided|audit/i);
    }
    // Nobody else: another business's owner (even claiming this organization), and nobody.
    expect(await suspensionOf(stranger.business.owner.userId, stranger.business.organizationId)).toBeNull();
    expect(await suspensionOf(stranger.business.owner.userId, provider.business.organizationId)).toBeNull();
    expect(await suspensionOf(null, null)).toBeNull();
    // The older yes/no answer still says yes.
    expect(await asTenant(app, provider.business.member.userId, provider.business.organizationId, async (client) => (await client.query("select app_listing_suspended() as data")).rows[0].data)).toBe(true);

    // The row holds the reason and the message as two different things.
    const row = await moderationRow(provider.listingId);
    expect(row).toMatchObject({ state: "suspended", reason: "INTERNAL-ONLY: complaint 4471, see ops notes", tenant_message: "Your listing names services you do not offer. Remove them and ask for a review.", review_state: "none" });
    expect(row.suspended_at).not.toBeNull();
    // The audit event records the message that was sent as well as the reason.
    const events = await audit(provider.listingId);
    expect(events.map((event) => event.action)).toEqual(["marketplace_listing.suspended"]);
    expect(events[0]).toMatchObject({ actor_kind: "platform_admin", actor_user_id: admin.userId, reason: "INTERNAL-ONLY: complaint 4471, see ops notes" });
    expect(events[0].metadata).toMatchObject({ organizationId: provider.business.organizationId, tenantMessage: "Your listing names services you do not offer. Remove them and ask for a review." });
  });

  test("a suspension with no message tells the business only that it is suspended; the three-argument call still works", async () => {
    const provider = await makeProvider("p19susc", handles());
    const admin = await makePlatformAdmin("p19suscadm", owner.db, owner.pool);
    await decide(admin.userId, provider.listingId, "suspended", null);
    const told = await suspensionOf(provider.business.owner.userId, provider.business.organizationId);
    expect(told).toMatchObject({ message: null, reviewState: "none" });
    expect((await moderationRow(provider.listingId)).reason).toBeNull();
  });

  test("the message can be changed or taken away while the suspension stands, and the reason is not touched", async () => {
    const provider = await makeProvider("p19susd", handles());
    const admin = await makePlatformAdmin("p19susdadm", owner.db, owner.pool);
    await decide(admin.userId, provider.listingId, "suspended", "internal reason", "First message");
    expect(await editMessage(admin.userId, provider.listingId, "  Second message  ")).toEqual({ found: true, changed: true, state: "suspended" });
    expect((await suspensionOf(provider.business.owner.userId, provider.business.organizationId))?.message).toBe("Second message");
    expect((await moderationRow(provider.listingId)).reason).toBe("internal reason");
    expect(await editMessage(admin.userId, provider.listingId, "Second message")).toMatchObject({ changed: false });
    expect(await editMessage(admin.userId, provider.listingId, "")).toMatchObject({ changed: true });
    expect((await suspensionOf(provider.business.owner.userId, provider.business.organizationId))?.message).toBeNull();
    await refused(editMessage(admin.userId, provider.listingId, "x".repeat(501)), "22023");
    expect((await audit(provider.listingId)).map((event) => event.action)).toEqual(["marketplace_listing.suspended", "marketplace_listing.message_updated", "marketplace_listing.message_updated"]);
    expect((await audit(provider.listingId))[2].metadata).toMatchObject({ cleared: true });

    // A listing that is not suspended has no message to change.
    const other = await makeProvider("p19susdb", handles());
    expect(await editMessage(admin.userId, other.listingId, "Hello")).toMatchObject({ found: true, changed: false, state: "allowed" });
    expect(await editMessage(admin.userId, "00000000-0000-4000-8000-000000000000", "Hello")).toEqual({ found: false, changed: false });
  });

  test("only a platform administrator decides, answers or writes to a business about a suspension; the business's own roles cannot", async () => {
    const provider = await makeProvider("p19suse", handles());
    const admin = await makePlatformAdmin("p19suseadm", owner.db, owner.pool);
    await decide(admin.userId, provider.listingId, "suspended", "r", "m");
    for (const person of [provider.business.owner.userId, provider.business.admin.userId, provider.business.member.userId, null]) {
      await refused(decide(person, provider.listingId, "allowed", null));
      await refused(decide(person, provider.listingId, "suspended", "x", "y"));
      await refused(editMessage(person, provider.listingId, "Mine"));
      await refused(keep(person, provider.listingId, null));
    }
    await refused(decide(admin.userId, provider.listingId, "banned", null), "22023");
    await refused(decide(admin.userId, provider.listingId, "suspended", "x", "y".repeat(501)), "22023");
    // The tables are not the business's to write either.
    for (const statement of ["update platform_listing_moderation set state = 'allowed'", "delete from platform_listing_moderation", "insert into platform_listing_moderation (listing_id, state, decided_by) values (gen_random_uuid(), 'allowed', 'x')"]) {
      await refused(asTenant(app, provider.business.owner.userId, provider.business.organizationId, (client) => client.query(statement)));
    }
    expect((await moderationRow(provider.listingId)).state).toBe("suspended");
  });
});

test.describe("a business asks for a second look", () => {
  test("an owner or admin can; it records who and what they wrote, changes nothing about visibility and cannot be repeated while it waits", async () => {
    const provider = await makeProvider("p19ask", handles());
    const admin = await makePlatformAdmin("p19askadm", owner.db, owner.pool);
    await decide(admin.userId, provider.listingId, "suspended", "internal", "Please fix the description.");

    expect(await ask(provider.business.admin.userId, provider.business.organizationId, "  I removed the services we do not offer.  ")).toEqual({ changed: true, result: "requested" });
    const row = await moderationRow(provider.listingId);
    expect(row).toMatchObject({ state: "suspended", review_state: "requested", review_requested_by: provider.business.admin.userId, review_note: "I removed the services we do not offer.", review_resolved_at: null, review_outcome: null });
    expect(row.review_requested_at).not.toBeNull();
    // Visibility is exactly as before: the listing is still suspended and is still not found.
    expect(await visible(provider)).toBe(false);
    expect(await found(provider)).toBe(0);
    const told = await suspensionOf(provider.business.member.userId, provider.business.organizationId);
    expect(told).toMatchObject({ reviewState: "requested", reviewNote: "I removed the services we do not offer." });

    expect(await ask(provider.business.owner.userId, provider.business.organizationId, "again")).toEqual({ changed: false, result: "already_requested" });
    expect((await moderationRow(provider.listingId)).review_note).toBe("I removed the services we do not offer.");
    const events = await audit(provider.listingId);
    expect(events.map((event) => event.action)).toEqual(["marketplace_listing.suspended", "marketplace_listing.review_requested"]);
    expect(events[1]).toMatchObject({ actor_kind: "organization_member", actor_user_id: provider.business.admin.userId, reason: "I removed the services we do not offer." });
    expect(events[1].metadata).toMatchObject({ organizationId: provider.business.organizationId, publicSlug: provider.slug });
  });

  test("a member, another business's owner (even naming this organization), and nobody cannot; a note over 500 characters is refused; an unsuspended listing has nothing to ask about", async () => {
    const provider = await makeProvider("p19askb", handles());
    const stranger = await makeProvider("p19askc", handles());
    const admin = await makePlatformAdmin("p19askbadm", owner.db, owner.pool);
    expect(await ask(provider.business.owner.userId, provider.business.organizationId, null)).toEqual({ changed: false, result: "not_suspended" });

    await decide(admin.userId, provider.listingId, "suspended", "internal");
    await refused(ask(provider.business.member.userId, provider.business.organizationId, "please"));
    await refused(ask(stranger.business.owner.userId, provider.business.organizationId, "please"));
    await refused(ask(null, null, "please"));
    await refused(ask(provider.business.owner.userId, provider.business.organizationId, "x".repeat(501)), "22023");
    // A request from another business's owner in THEIR OWN organization is about their own listing, which is not suspended.
    expect(await ask(stranger.business.owner.userId, stranger.business.organizationId, "please")).toEqual({ changed: false, result: "not_suspended" });
    expect((await moderationRow(provider.listingId)).review_state).toBe("none");
    // An empty note is fine: the request still records who asked.
    expect(await ask(provider.business.owner.userId, provider.business.organizationId, "   ")).toEqual({ changed: true, result: "requested" });
    expect((await moderationRow(provider.listingId)).review_note).toBeNull();
  });

  test("the platform sees the request first, in the list and in the count; keeping the suspension answers it, with a message", async () => {
    const provider = await makeProvider("p19ansk", handles());
    const admin = await makePlatformAdmin("p19answadm", owner.db, owner.pool);
    await decide(admin.userId, provider.listingId, "suspended", "internal", "Fix it");
    // Nothing to answer yet.
    expect(await keep(admin.userId, provider.listingId, "No")).toMatchObject({ found: true, changed: false, reviewState: "none" });
    await ask(provider.business.owner.userId, provider.business.organizationId, "Done");

    const listing = await asTenant(app, admin.userId, null, async (client) => {
      const page = await data<{ rows: { id: string; moderation: Record<string, unknown> }[] }>(client, "select app_platform_listings($1, 100, 0) as data", [provider.token]);
      const overview = await data<{ pendingListingReviews: number }>(client, "select app_platform_overview() as data");
      return { row: page.rows.find((candidate) => candidate.id === provider.listingId), pending: overview.pendingListingReviews };
    });
    expect(listing.row?.moderation).toMatchObject({ state: "suspended", reason: "internal", tenantMessage: "Fix it", reviewState: "requested", reviewNote: "Done" });
    expect(listing.pending).toBeGreaterThanOrEqual(1);

    expect(await keep(admin.userId, provider.listingId, "  We looked again; the description still lists a service you do not offer.  ")).toEqual({ found: true, changed: true, state: "suspended", reviewState: "resolved" });
    const row = await moderationRow(provider.listingId);
    expect(row).toMatchObject({ state: "suspended", review_state: "resolved", review_outcome: "kept", reason: "internal", tenant_message: "We looked again; the description still lists a service you do not offer." });
    expect(row.review_resolved_at).not.toBeNull();
    expect(await visible(provider)).toBe(false);
    const told = await suspensionOf(provider.business.owner.userId, provider.business.organizationId);
    expect(told).toMatchObject({ reviewState: "resolved", reviewOutcome: "kept", message: "We looked again; the description still lists a service you do not offer." });
    expect((await audit(provider.listingId)).map((event) => event.action)).toEqual(["marketplace_listing.suspended", "marketplace_listing.review_requested", "marketplace_listing.review_resolved"]);
    expect((await audit(provider.listingId))[2].metadata).toMatchObject({ outcome: "kept" });
    // Answering twice does nothing.
    expect(await keep(admin.userId, provider.listingId, "Again")).toMatchObject({ changed: false, reviewState: "resolved" });
  });

  test("after the platform keeps a suspension the business waits a day before asking again, and then can", async () => {
    const provider = await makeProvider("p19wait", handles());
    const admin = await makePlatformAdmin("p19waitadm", owner.db, owner.pool);
    await decide(admin.userId, provider.listingId, "suspended", "internal");
    await ask(provider.business.owner.userId, provider.business.organizationId, "first");
    await keep(admin.userId, provider.listingId, null);

    const soon = await ask(provider.business.owner.userId, provider.business.organizationId, "second");
    expect(soon).toMatchObject({ changed: false, result: "too_soon" });
    expect(new Date(soon.retryAfter!).getTime()).toBeGreaterThan(Date.now() + 20 * 3600_000);
    expect((await moderationRow(provider.listingId)).review_state).toBe("resolved");

    await owner.pool.query("update platform_listing_moderation set review_resolved_at = now() - interval '25 hours' where listing_id = $1", [provider.listingId]);
    expect(await ask(provider.business.owner.userId, provider.business.organizationId, "third")).toEqual({ changed: true, result: "requested" });
    expect((await moderationRow(provider.listingId))).toMatchObject({ review_state: "requested", review_note: "third", review_resolved_at: null, review_outcome: null });
    expect((await audit(provider.listingId)).filter((event) => event.action === "marketplace_listing.review_requested")).toHaveLength(2);
  });

  test("allowing the listing again answers a waiting request as lifted, restores it only while its business still has it published, and a new suspension starts afresh", async () => {
    const provider = await makeProvider("p19lift", handles());
    const hiddenByBusiness = await makeProvider("p19lifth", handles(), { status: "hidden" });
    const admin = await makePlatformAdmin("p19liftadm", owner.db, owner.pool);

    await decide(admin.userId, provider.listingId, "suspended", "internal", "Fix it");
    await ask(provider.business.owner.userId, provider.business.organizationId, "Done");
    expect(await decide(admin.userId, provider.listingId, "allowed", null)).toEqual({ found: true, changed: true, state: "allowed" });
    expect(await visible(provider)).toBe(true);
    expect(await found(provider)).toBe(1);
    const row = await moderationRow(provider.listingId);
    expect(row).toMatchObject({ state: "allowed", reason: null, tenant_message: null, suspended_at: null, review_state: "resolved", review_outcome: "lifted" });
    expect(await suspensionOf(provider.business.owner.userId, provider.business.organizationId)).toBeNull();
    expect((await audit(provider.listingId)).map((event) => event.action)).toEqual(["marketplace_listing.suspended", "marketplace_listing.review_requested", "marketplace_listing.unsuspended", "marketplace_listing.review_resolved"]);
    expect((await audit(provider.listingId))[3].metadata).toMatchObject({ outcome: "lifted" });

    // The business decided its listing is hidden: lifting the suspension does not make it public.
    await decide(admin.userId, hiddenByBusiness.listingId, "suspended", "x");
    await decide(admin.userId, hiddenByBusiness.listingId, "allowed", null);
    expect(await visible(hiddenByBusiness)).toBe(false);
    expect(await found(hiddenByBusiness)).toBe(0);

    // A new suspension forgets the old request: the business starts from none, with the new message.
    await decide(admin.userId, provider.listingId, "suspended", "second internal", "Second message");
    expect(await moderationRow(provider.listingId)).toMatchObject({ state: "suspended", reason: "second internal", tenant_message: "Second message", review_state: "none", review_requested_at: null, review_requested_by: null, review_note: null, review_resolved_at: null, review_outcome: null, revision: 3 });
    expect(await ask(provider.business.owner.userId, provider.business.organizationId, "now")).toEqual({ changed: true, result: "requested" });
  });

  test("deciding what a listing already is records nothing", async () => {
    const provider = await makeProvider("p19same", handles());
    const admin = await makePlatformAdmin("p19sameadm", owner.db, owner.pool);
    expect(await decide(admin.userId, provider.listingId, "allowed", null)).toEqual({ found: true, changed: false, state: "allowed" });
    await decide(admin.userId, provider.listingId, "suspended", "r", "m");
    expect(await decide(admin.userId, provider.listingId, "suspended", "other", "other")).toEqual({ found: true, changed: false, state: "suspended" });
    expect((await moderationRow(provider.listingId)).tenant_message).toBe("m");
    expect(await audit(provider.listingId)).toHaveLength(1);
  });
});

test.describe("the table holds the lifecycle to its shape", () => {
  test("a message only on a suspension; a request only on a suspended listing; none means every request field is empty", async () => {
    const provider = await makeProvider("p19shape", handles());
    const run = async (statement: string, values: unknown[] = []) => {
      const client = await owner.pool.connect();
      try {
        await client.query("begin");
        await client.query("insert into platform_listing_moderation (listing_id, state, decided_by) values ($1, 'allowed', 'specs') on conflict (listing_id) do update set state = 'allowed'", [provider.listingId]);
        await client.query(statement, [provider.listingId, ...values]);
      } finally {
        await client.query("rollback");
        client.release();
      }
    };
    await expect(run("update platform_listing_moderation set tenant_message = 'x' where listing_id = $1")).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_tenant_message" });
    await expect(run("update platform_listing_moderation set state = 'suspended', tenant_message = '   ' where listing_id = $1")).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_tenant_message" });
    await expect(run("update platform_listing_moderation set state = 'suspended', tenant_message = $2 where listing_id = $1", ["x".repeat(501)])).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_tenant_message" });
    await expect(run("update platform_listing_moderation set review_state = 'requested', review_requested_at = now(), review_requested_by = 'u' where listing_id = $1")).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_review_shape" });
    await expect(run("update platform_listing_moderation set state = 'suspended', review_state = 'requested' where listing_id = $1")).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_review_shape" });
    await expect(run("update platform_listing_moderation set review_note = 'x' where listing_id = $1")).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_review_shape" });
    await expect(run("update platform_listing_moderation set review_state = 'resolved', review_requested_at = now(), review_requested_by = 'u', review_resolved_at = now(), review_outcome = 'maybe' where listing_id = $1")).rejects.toMatchObject({ code: "23514", constraint: "platform_listing_moderation_review_shape" });
    // (Both the state's own check and the shape fail here; the database reports them in name order, so the shape's name is the one that comes back.)
    await expect(run("update platform_listing_moderation set review_state = 'later' where listing_id = $1")).rejects.toMatchObject({ code: "23514" });
  });
});
