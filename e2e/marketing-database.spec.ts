/**
 * Phase 14: tenant isolation and integrity of the Marketing tables and the Analytics baseline at the DATABASE, independent of the
 * application code, and the campaign operations as the application's database layer runs them.
 *
 * Like maintenance-reviews-database.spec.ts, the first half connects to the freshly migrated and seeded test database as the
 * restricted runtime role the app uses (`climvia_app`, DATABASE_URL), sets the transaction-local context the way src/db/tenant.ts
 * does, and checks that PostgreSQL itself keeps businesses apart: Row Level Security for who may read and write, column grants for
 * what may change, composite foreign keys for what may point at what, and a trigger for what a campaign may become. Every test in
 * that half runs in a transaction that is rolled back.
 *
 * The second half runs the operations (schedule, send, cancel, duplicate) through src/db/marketing-queries on the worker's own copy of
 * the Apex business, committing, to check what they store (the recipient snapshot, the business-local time, the recipient count) and
 * what races cannot do (two snapshots, two transitions, a send of a cancelled campaign).
 */
import { test as base, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";
import type { Tx } from "../src/db";
import { cancelScheduleTx, duplicateTx, loadAudienceSizes, loadCampaignRecipients, loadMarketing, resolveAudience, saveDraftTx, scheduleTx, sendTx, type MarketingContext } from "../src/db/marketing-queries";
import { loadRefs } from "../src/db/ops-queries";
import { withTenant } from "../src/db/tenant";
import { localToInstant } from "../src/lib/business-time";
import { GONE_CAMPAIGN, SENT_CAMPAIGN, STALE_CAMPAIGN, type CampaignContent } from "../src/lib/marketing-rules";
import { Refusal } from "../src/lib/refusal";
import { test as workerTest } from "./fixtures";

const test = base;

const SEED = {
  alex: "alex.morgan@apex.test", // Apex owner
  jamie: "jamie.rivera@apex.test", // Apex member
  taylor: "taylor.brooks@northstar.test", // Northstar owner
  casey: "casey.nguyen@climvia.test", // admin in both
};

let app: Pool;
let admin: Pool;
const user: Record<string, string> = {};
let apex = "";
let northstar = "";
/** Database ids of the records the tests point at, per business. */
const a: Record<string, string> = {};
const n: Record<string, string> = {};

const idOf = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0].id;
const bySlug = (table: string, organizationId: string, slug: string) => idOf(`select id from ${table} where organization_id = $1 and slug = $2`, [organizationId, slug]);

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  for (const [key, email] of Object.entries(SEED)) user[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  apex = await idOf("select id from organizations where slug = 'apex-climate-heating-air'", []);
  northstar = await idOf("select id from organizations where slug = 'northstar-heating-cooling'", []);

  a.sarah = await bySlug("customers", apex, "sarah-mitchell");
  a.david = await bySlug("customers", apex, "david-chen");
  a.fall = await bySlug("marketing_campaigns", apex, "cmp-fall-maintenance-reminder");
  a.cooling = await bySlug("marketing_campaigns", apex, "cmp-cooling-tune-up-reminder");
  a.seasonal = await bySlug("marketing_campaigns", apex, "cmp-seasonal-service-reminder");
  a.tips = await bySlug("marketing_campaigns", apex, "cmp-heat-pump-efficiency-tips");
  a.member = (await admin.query<{ id: string }>("select id from team_members where organization_id = $1 order by position limit 1", [apex])).rows[0].id;

  n.marta = await bySlug("customers", northstar, "marta-olsen");
  n.priya = await bySlug("customers", northstar, "priya-raman");
  n.draft = await bySlug("marketing_campaigns", northstar, "cmp-furnace-tune-up-season-notice");
  n.sent = await bySlug("marketing_campaigns", northstar, "cmp-radiant-heat-estimate-offer");
  n.member = (await admin.query<{ id: string }>("select id from team_members where organization_id = $1 order by position limit 1", [northstar])).rows[0].id;
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined; constraint?: undefined } | { value?: undefined; error: string; code?: string; constraint?: string };

const failure = (error: unknown): { error: string; code?: string; constraint?: string } => ({
  error: error instanceof Error ? error.message : String(error),
  code: (error as { code?: string }).code,
  constraint: (error as { constraint?: string }).constraint,
});

/** Run `fn` as `userId` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(userId: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** The same, through the owner role (no Row Level Security): for what only the seed may write, to check the constraints. */
async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await admin.connect();
  try {
    await client.query("begin");
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
const PERMISSION = "42501";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const CHECK = "23514";

async function insertRow(client: PoolClient, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const result = await client.query<{ id: string }>(
    `insert into ${table} (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return result.rows[0].id;
}

let sequence = 0;
/** A valid new Draft of `org`, unless `overrides` say otherwise. */
const draft = (org: string, overrides: Record<string, unknown> = {}) => ({
  organization_id: org,
  slug: `cmp-test-${(sequence += 1)}`,
  name: "Test campaign",
  channel: "email",
  audience_id: "all-customers",
  status: "draft",
  ...overrides,
});

const recipient = (org: string, campaign: string, customer: string | null, overrides: Record<string, unknown> = {}) => ({
  organization_id: org,
  campaign_id: campaign,
  customer_id: customer,
  recipient_name: "Someone",
  recipient_email: "someone@example.test",
  status: "pending",
  ...overrides,
});

const TABLES = ["marketing_campaigns", "marketing_campaign_recipients", "marketing_campaign_selected_customers", "analytics_imported_baselines"];

test.describe("who can read what", () => {
  test("a member of the active business reads its campaigns, recipients, chosen customers and baseline; the other business's are invisible", async () => {
    for (const who of ["alex", "jamie"]) {
      const result = await as(user[who], apex, async (c) => ({
        campaigns: await count(c, "marketing_campaigns"),
        recipients: await count(c, "marketing_campaign_recipients"),
        baselines: await count(c, "analytics_imported_baselines"),
        slugs: (await c.query<{ slug: string }>("select slug from marketing_campaigns where slug like 'cmp-furnace%' or slug like 'cmp-radiant%'")).rows,
      }));
      expect(result.value, who).toMatchObject({ campaigns: 11, recipients: 6, slugs: [] });
      expect(result.value!.baselines, who).toBeGreaterThan(40);
    }
    // Casey is an admin of both businesses and reads the one the context names: Northstar's own two campaigns, one recipient.
    const northstarView = await as(user.casey, northstar, async (c) => ({ campaigns: await count(c, "marketing_campaigns"), recipients: await count(c, "marketing_campaign_recipients"), names: (await c.query<{ name: string }>("select name from marketing_campaigns order by position")).rows.map((r) => r.name) }));
    expect(northstarView.value).toEqual({ campaigns: 2, recipients: 1, names: ["Furnace tune-up season notice", "Radiant heat estimate offer"] });
  });

  test("no context, someone who is not a member, and a business the person does not belong to see nothing in any of the four tables", async () => {
    for (const [who, org] of [[null, null], [user.taylor, apex], [user.alex, northstar], [user.alex, null], [user.jamie, northstar]] as const) {
      const result = await as(who, org, async (c) => {
        const counts: number[] = [];
        for (const table of TABLES) counts.push(await count(c, table));
        return counts;
      });
      expect(result.value, `${who}/${org}`).toEqual([0, 0, 0, 0]);
    }
  });
});

test.describe("campaigns: who can write", () => {
  test("an owner or admin creates a Draft; a member, a stranger and a context for another business cannot", async () => {
    expect((await as(user.alex, apex, (c) => insertRow(c, "marketing_campaigns", draft(apex)))).value).toBeTruthy();
    expect((await as(user.casey, apex, (c) => insertRow(c, "marketing_campaigns", draft(apex)))).value).toBeTruthy();
    expect((await as(user.casey, northstar, (c) => insertRow(c, "marketing_campaigns", draft(northstar)))).value).toBeTruthy();
    for (const [who, org, target] of [[user.jamie, apex, apex], [user.taylor, apex, apex], [null, null, apex], [user.alex, apex, northstar], [user.alex, northstar, northstar], [user.taylor, northstar, apex]] as const) {
      const result = await as(who, org, (c) => insertRow(c, "marketing_campaigns", draft(target)));
      expect(result.code, `${who}/${org}/${target}`).toBe(PERMISSION);
    }
  });

  test("a campaign cannot be created already Scheduled or Sent, or with a delivery result: those are earned by a transition", async () => {
    const earned: Record<string, unknown>[] = [
      { status: "scheduled", scheduled_for: "2030-01-01T10:00:00Z", recipient_count: 3 },
      { status: "sent", sent_on: "2024-10-25", sent_at: "2024-10-25T15:45:00Z", recipient_count: 3 },
      { sent_on: "2024-10-25" },
      { sent_at: "2024-10-25T15:45:00Z" },
      { scheduled_for: "2030-01-01T10:00:00Z" },
      { cancelled_at: "2024-10-25T15:45:00Z" },
      { delivered_count: 1, not_delivered_count: 0, recipient_count: 1 },
    ];
    for (const extra of earned) expect((await as(user.alex, apex, (c) => insertRow(c, "marketing_campaigns", draft(apex, extra)))).code, JSON.stringify(extra)).toBe(PERMISSION);
  });

  test("an owner edits a Draft's content; a member's edit changes nothing; another business's campaign is out of reach even for an admin of both", async () => {
    const edited = await as(user.alex, apex, async (c) => (await c.query("update marketing_campaigns set name = 'Renamed' where id = $1", [a.seasonal])).rowCount);
    expect(edited.value).toBe(1);
    const member = await as(user.jamie, apex, async (c) => (await c.query("update marketing_campaigns set name = 'Renamed' where id = $1", [a.seasonal])).rowCount);
    expect(member.value).toBe(0);
    // Casey, in Apex's context, cannot reach Northstar's campaign by its id, and in Northstar's context cannot reach Apex's.
    expect((await as(user.casey, apex, async (c) => (await c.query("update marketing_campaigns set name = 'Hijack' where id = $1", [n.draft])).rowCount)).value).toBe(0);
    expect((await as(user.casey, northstar, async (c) => (await c.query("update marketing_campaigns set name = 'Hijack' where id = $1", [a.seasonal])).rowCount)).value).toBe(0);
  });

  test("what an update may touch is limited by column: never the id, the reference, the creator, the order, or the recorded delivery result", async () => {
    for (const set of ["slug = 'cmp-other'", "created_by = null", "position = 99", "organization_id = organization_id", "delivered_count = 1", "not_delivered_count = 0", "id = id", "created_at = now()", "updated_at = now()"]) {
      const result = await as(user.alex, apex, (c) => c.query(`update marketing_campaigns set ${set} where id = $1`, [a.seasonal]));
      // The order is an identity column: PostgreSQL says so (428C9) before it looks at privileges.
      expect(result.code, set).toBe(set === "position = 99" ? "428C9" : PERMISSION);
    }
  });

  test("nobody deletes a campaign through the application, not even an owner", async () => {
    for (const who of ["alex", "casey"] as const) {
      expect((await as(user[who], apex, (c) => c.query("delete from marketing_campaigns where id = $1", [a.seasonal]))).code, who).toBe(PERMISSION);
    }
  });
});

test.describe("campaigns: the way through Draft, Scheduled and Sent", () => {
  test("a Draft becomes Scheduled with its time and count, and goes back to Draft with the cancellation stamped; the stamp is not for anything else", async () => {
    const result = await as(user.alex, apex, async (c) => {
      await c.query("update marketing_campaigns set status = 'scheduled', scheduled_for = '2030-01-01T16:30:00Z', recipient_count = 3 where id = $1", [a.seasonal]);
      const scheduled = (await c.query("select status, scheduled_for, cancelled_at from marketing_campaigns where id = $1", [a.seasonal])).rows[0];
      await c.query("update marketing_campaigns set status = 'draft', scheduled_for = null where id = $1", [a.seasonal]);
      const cancelled = (await c.query("select status, scheduled_for, cancelled_at, recipient_count from marketing_campaigns where id = $1", [a.seasonal])).rows[0];
      return { scheduled, cancelled };
    });
    expect(result.value!.scheduled).toMatchObject({ status: "scheduled", cancelled_at: null });
    expect(result.value!.cancelled).toMatchObject({ status: "draft", scheduled_for: null, recipient_count: 3 });
    expect(result.value!.cancelled.cancelled_at).toBeTruthy();
    // cancelled_at moves only when a schedule is cancelled.
    const stray = await as(user.alex, apex, (c) => c.query("update marketing_campaigns set cancelled_at = now() where id = $1", [a.seasonal]));
    expect(stray).toMatchObject({ code: CHECK, constraint: "campaigns_cancelled_at" });
  });

  test("a campaign cannot say it is Scheduled without a time or a count, or Sent without its day, or carry a time it is not waiting for", async () => {
    const attempts: [string, string][] = [
      ["status = 'scheduled', recipient_count = 3", "campaigns_scheduled"],
      ["status = 'scheduled', scheduled_for = '2030-01-01T10:00:00Z'", "campaigns_scheduled_count"],
      ["status = 'sent', recipient_count = 3", "campaigns_sent"],
      ["scheduled_for = '2030-01-01T10:00:00Z'", "campaigns_scheduled"],
      ["sent_on = '2024-10-25'", "campaigns_sent"],
    ];
    for (const [set, constraint] of attempts) {
      const result = await as(user.alex, apex, (c) => c.query(`update marketing_campaigns set ${set} where id = $1`, [a.seasonal]));
      expect(result, set).toMatchObject({ code: CHECK, constraint });
    }
  });

  test("a Sent campaign is final: no column of it changes, by anyone, however it is asked", async () => {
    for (const [who, org] of [[user.alex, apex], [user.casey, apex]] as const) {
      for (const set of ["name = 'Changed'", "message = 'Changed'", "status = 'draft', sent_on = null, sent_at = null", "recipient_count = 1, delivered_count = null, not_delivered_count = null", "status = 'scheduled', sent_on = null, sent_at = null, scheduled_for = '2030-01-01T10:00:00Z'"]) {
        const result = await as(who, org, (c) => c.query(`update marketing_campaigns set ${set} where id = $1`, [a.cooling]));
        expect(result.constraint ?? result.code, `${who}: ${set}`).toMatch(/campaigns_final|42501/);
      }
    }
    // Even the owner role, which Row Level Security does not bind, meets the guard.
    const owner = await asOwner((c) => c.query("update marketing_campaigns set name = 'Changed' where id = $1", [a.cooling]));
    expect(owner).toMatchObject({ code: CHECK, constraint: "campaigns_final" });
  });

  test("a Scheduled campaign cannot go back to Draft while its recipient snapshot is still there", async () => {
    const result = await asOwner(async (c) => {
      await c.query("insert into marketing_campaign_recipients (organization_id, campaign_id, customer_id, recipient_name, recipient_email, status) values ($1, $2, $3, 'Sarah', 'sarah@example.test', 'pending')", [apex, a.fall, a.sarah]);
      await c.query("update marketing_campaigns set status = 'draft', scheduled_for = null where id = $1", [a.fall]);
    });
    expect(result).toMatchObject({ code: CHECK, constraint: "campaigns_draft_snapshot" });
  });

  test("the recorded delivery result adds up: delivered + not delivered = recipients, both or neither, and only on a Sent campaign", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ status: "sent", sent_on: "2024-10-18", recipient_count: 42, delivered_count: 40, not_delivered_count: 3 }, "campaigns_delivery"],
      [{ status: "sent", sent_on: "2024-10-18", recipient_count: 42, delivered_count: 40 }, "campaigns_delivery"],
      [{ status: "sent", sent_on: "2024-10-18", recipient_count: 42, delivered_count: -1, not_delivered_count: 43 }, "campaigns_delivery"],
      [{ recipient_count: 2, delivered_count: 1, not_delivered_count: 1 }, "campaigns_delivery"],
    ];
    for (const [row, constraint] of bad) expect(await asOwner((c) => insertRow(c, "marketing_campaigns", draft(apex, row))), JSON.stringify(row)).toMatchObject({ code: CHECK, constraint });
    expect((await asOwner((c) => insertRow(c, "marketing_campaigns", draft(apex, { status: "sent", sent_on: "2024-10-18", recipient_count: 42, delivered_count: 40, not_delivered_count: 2 })))).value).toBeTruthy();
  });

  test("the status, channel and audience are from their lists; a text message is short and has no subject; the reference is unique within a business only", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ status: "paused", recipient_count: 3 }, "campaigns_status"],
      [{ channel: "fax" }, "campaigns_channel"],
      [{ audience_id: "everyone" }, "campaigns_audience"],
      [{ channel: "sms", message: "x".repeat(161) }, "campaigns_message"],
      [{ channel: "sms", subject: "Not for a text" }, "campaigns_subject"],
      [{ name: "  " }, "campaigns_name"],
      [{ slug: "Not A Slug" }, "campaigns_slug"],
    ];
    for (const [row, constraint] of bad) expect(await asOwner((c) => insertRow(c, "marketing_campaigns", draft(apex, row))), JSON.stringify(row)).toMatchObject({ code: CHECK, constraint });
    expect((await asOwner((c) => insertRow(c, "marketing_campaigns", draft(apex, { slug: "cmp-fall-maintenance-reminder" })))).constraint).toBe("campaigns_org_slug_unique");
    // The same reference in another business is another campaign.
    expect((await asOwner((c) => insertRow(c, "marketing_campaigns", draft(northstar, { slug: "cmp-fall-maintenance-reminder" })))).value).toBeTruthy();
  });
});

test.describe("recipients: a snapshot written once, with the campaign that earned it", () => {
  test("a recipient cannot be added to a campaign that was not just scheduled or sent: not a Draft, not a Scheduled or Sent one on its own", async () => {
    for (const campaign of [a.seasonal, a.fall, a.cooling]) {
      const result = await as(user.alex, apex, (c) => insertRow(c, "marketing_campaign_recipients", recipient(apex, campaign, a.sarah)));
      expect(result.code, campaign).toBe(PERMISSION);
    }
  });

  test("in the transaction that schedules or sends a campaign its recipients can be written, as pending; a delivery result cannot be", async () => {
    const scheduled = await as(user.alex, apex, async (c) => {
      await c.query("update marketing_campaigns set status = 'scheduled', scheduled_for = '2030-01-01T16:30:00Z', recipient_count = 2 where id = $1", [a.seasonal]);
      await insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, a.sarah));
      await insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, a.david, { recipient_name: "David Chen" }));
      return count(c, "marketing_campaign_recipients");
    });
    expect(scheduled.value).toBe(6 + 2);
    const sent = await as(user.alex, apex, async (c) => {
      await c.query("update marketing_campaigns set status = 'sent', sent_on = '2024-10-25', sent_at = now(), recipient_count = 1 where id = $1", [a.tips]);
      return insertRow(c, "marketing_campaign_recipients", recipient(apex, a.tips, a.sarah));
    });
    expect(sent.value).toBeTruthy();
    for (const result of [{ status: "delivered", delivered_at: "2024-10-25T15:45:00Z" }, { status: "not-delivered", delivered_at: "2024-10-25T15:45:00Z", failure_reason: "x" }, { delivered_at: "2024-10-25T15:45:00Z" }, { failure_reason: "x" }]) {
      const outcome = await as(user.alex, apex, async (c) => {
        await c.query("update marketing_campaigns set status = 'sent', sent_on = '2024-10-25', recipient_count = 1 where id = $1", [a.tips]);
        return insertRow(c, "marketing_campaign_recipients", recipient(apex, a.tips, a.sarah, result));
      });
      expect(outcome.code, JSON.stringify(result)).toBe(PERMISSION);
    }
    // A member cannot write a snapshot either.
    expect((await as(user.jamie, apex, (c) => insertRow(c, "marketing_campaign_recipients", recipient(apex, a.tips, a.sarah)))).code).toBe(PERMISSION);
  });

  test("a recipient row is never rewritten, and a Sent campaign's recipients are a permanent record that nobody deletes", async () => {
    expect((await as(user.alex, apex, (c) => c.query("update marketing_campaign_recipients set recipient_name = 'Changed' where campaign_id = $1", [a.cooling]))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (c) => c.query("update marketing_campaign_recipients set status = 'delivered' where campaign_id = $1", [a.cooling]))).code).toBe(PERMISSION);
    for (const who of ["alex", "casey"] as const) {
      const result = await as(user[who], apex, async (c) => ({ deleted: (await c.query("delete from marketing_campaign_recipients where campaign_id = $1", [a.cooling])).rowCount, left: await count(c, "marketing_campaign_recipients") }));
      expect(result.value, who).toEqual({ deleted: 0, left: 6 });
    }
    // A pending snapshot goes only while its campaign is Scheduled (a reschedule, a cancel or a send replaces it).
    const replaced = await as(user.alex, apex, async (c) => {
      await c.query("update marketing_campaigns set recipient_count = recipient_count where id = $1", [a.fall]);
      await insertRow(c, "marketing_campaign_recipients", recipient(apex, a.fall, a.sarah));
      return (await c.query("delete from marketing_campaign_recipients where campaign_id = $1", [a.fall])).rowCount;
    });
    expect(replaced.value).toBe(1);
    // A member's delete reaches nothing.
    expect((await as(user.jamie, apex, async (c) => (await c.query("delete from marketing_campaign_recipients where campaign_id = $1", [a.cooling])).rowCount)).value).toBe(0);
  });

  test("a recipient is in a campaign's snapshot once, and one without a customer record is allowed", async () => {
    const result = await as(user.alex, apex, async (c) => {
      await c.query("update marketing_campaigns set status = 'scheduled', scheduled_for = '2030-01-01T16:30:00Z', recipient_count = 3 where id = $1", [a.seasonal]);
      await insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, a.sarah));
      await insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, null, { recipient_name: "No record" }));
      await insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, null, { recipient_name: "Also no record" }));
      return insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, a.sarah));
    });
    expect(result).toMatchObject({ code: UNIQUE, constraint: "campaign_recipients_customer_unique" });
  });

  test("a recipient names a customer of the SAME business: an Apex campaign cannot list a Northstar customer, or the other way round", async () => {
    // Even through the owner role, which Row Level Security does not bind.
    expect(await asOwner((c) => insertRow(c, "marketing_campaign_recipients", recipient(apex, a.cooling, n.marta)))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_recipients_customer_fk" });
    expect(await asOwner((c) => insertRow(c, "marketing_campaign_recipients", recipient(northstar, n.sent, a.sarah)))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_recipients_customer_fk" });
    // Through the runtime role, in the transaction that earned the snapshot, the foreign key is what refuses.
    const viaApp = await as(user.alex, apex, async (c) => {
      await c.query("update marketing_campaigns set status = 'scheduled', scheduled_for = '2030-01-01T16:30:00Z', recipient_count = 1 where id = $1", [a.seasonal]);
      return insertRow(c, "marketing_campaign_recipients", recipient(apex, a.seasonal, n.marta));
    });
    expect(viaApp).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_recipients_customer_fk" });
  });

  test("a recipient belongs to a campaign of the SAME business, and the business context decides what may be written", async () => {
    expect(await asOwner((c) => insertRow(c, "marketing_campaign_recipients", recipient(northstar, a.cooling, n.marta)))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_recipients_campaign_fk" });
    expect(await asOwner((c) => insertRow(c, "marketing_campaign_recipients", recipient(apex, n.sent, a.sarah)))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_recipients_campaign_fk" });
    // Casey is an admin of both. With Northstar as the active business, a recipient for Apex's campaign is refused by the policy,
    // and one labelled Northstar's that points at Apex's campaign by its foreign key.
    const wrongContext = await as(user.casey, northstar, async (c) => {
      await c.query("update marketing_campaigns set recipient_count = recipient_count where id = $1", [a.fall]);
      return insertRow(c, "marketing_campaign_recipients", recipient(apex, a.fall, a.sarah));
    });
    expect(wrongContext.code).toBe(PERMISSION);
    const mislabelled = await as(user.casey, northstar, (c) => insertRow(c, "marketing_campaign_recipients", recipient(northstar, a.fall, n.marta)));
    expect(mislabelled.code).toBe(PERMISSION);
  });

  test("a recipient has a status from the list, a result only with a time, and a reason only with 'not delivered'", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ status: "queued", delivered_at: "2024-10-18T15:15:00Z" }, "campaign_recipients_status"],
      [{ status: "pending", delivered_at: "2024-10-18T15:15:00Z" }, "campaign_recipients_result"],
      [{ status: "delivered" }, "campaign_recipients_result"],
      [{ status: "delivered", delivered_at: "2024-10-18T15:15:00Z", failure_reason: "x" }, "campaign_recipients_result"],
      [{ recipient_name: " " }, "campaign_recipients_name"],
    ];
    for (const [row, constraint] of bad) expect(await asOwner((c) => insertRow(c, "marketing_campaign_recipients", recipient(apex, a.cooling, null, row))), JSON.stringify(row)).toMatchObject({ code: CHECK, constraint });
    expect((await asOwner((c) => insertRow(c, "marketing_campaign_recipients", recipient(apex, a.cooling, null, { status: "not-delivered", delivered_at: "2024-10-18T15:16:00Z", failure_reason: "No answer" })))).value).toBeTruthy();
  });
});

test.describe("chosen customers", () => {
  test("customers can be chosen or dropped while the campaign is not Sent, only by an owner or admin, and only the business's own", async () => {
    const result = await as(user.alex, apex, async (c) => {
      const id = await insertRow(c, "marketing_campaign_selected_customers", { organization_id: apex, campaign_id: a.seasonal, customer_id: a.sarah });
      const removed = (await c.query("delete from marketing_campaign_selected_customers where id = $1", [id])).rowCount;
      return { id, removed };
    });
    expect(result.value).toMatchObject({ removed: 1 });
    expect((await as(user.jamie, apex, (c) => insertRow(c, "marketing_campaign_selected_customers", { organization_id: apex, campaign_id: a.seasonal, customer_id: a.sarah }))).code).toBe(PERMISSION);
    expect(await as(user.alex, apex, (c) => insertRow(c, "marketing_campaign_selected_customers", { organization_id: apex, campaign_id: a.seasonal, customer_id: n.marta }))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_selected_customer_fk" });
    expect(await asOwner((c) => insertRow(c, "marketing_campaign_selected_customers", { organization_id: northstar, campaign_id: a.seasonal, customer_id: n.marta }))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaign_selected_campaign_fk" });
  });

  test("a customer is chosen for a campaign once, and nothing can be chosen for a Sent campaign", async () => {
    expect((await as(user.alex, apex, (c) => insertRow(c, "marketing_campaign_selected_customers", { organization_id: apex, campaign_id: a.cooling, customer_id: a.sarah }))).code).toBe(PERMISSION);
    const duplicate = await as(user.alex, apex, async (c) => {
      await insertRow(c, "marketing_campaign_selected_customers", { organization_id: apex, campaign_id: a.seasonal, customer_id: a.sarah });
      return insertRow(c, "marketing_campaign_selected_customers", { organization_id: apex, campaign_id: a.seasonal, customer_id: a.sarah });
    });
    expect(duplicate).toMatchObject({ code: UNIQUE, constraint: "campaign_selected_unique" });
  });

  test("the person who made a campaign is a Team member of the SAME business", async () => {
    expect(await asOwner((c) => insertRow(c, "marketing_campaigns", draft(apex, { created_by: n.member })))).toMatchObject({ code: FOREIGN_KEY, constraint: "campaigns_created_by_fk" });
    expect((await asOwner((c) => insertRow(c, "marketing_campaigns", draft(apex, { created_by: a.member })))).value).toBeTruthy();
  });
});

test.describe("the imported baseline: read only", () => {
  test("a member reads the baseline of the active business and no one else's; no one writes it through the application", async () => {
    const apexRows = await as(user.alex, apex, async (c) => (await c.query("select distinct organization_id from analytics_imported_baselines")).rows.map((row) => row.organization_id));
    expect(apexRows.value).toEqual([apex]);
    const northstarRows = await as(user.taylor, northstar, async (c) => (await c.query("select distinct organization_id from analytics_imported_baselines")).rows.map((row) => row.organization_id));
    expect(northstarRows.value).toEqual([northstar]);
    const row = { organization_id: apex, metric_key: "bookings.by_status", dimension: "confirmed", period_start: "2024-10-01", period_end: "2024-10-31", integer_value: 9 };
    for (const [who, org] of [[user.alex, apex], [user.casey, apex], [user.jamie, apex]] as const) {
      expect((await as(who, org, (c) => insertRow(c, "analytics_imported_baselines", { ...row, dimension: "new" }))).code, "insert").toBe(PERMISSION);
      expect((await as(who, org, (c) => c.query("update analytics_imported_baselines set integer_value = 99"))).code, "update").toBe(PERMISSION);
      expect((await as(who, org, (c) => c.query("delete from analytics_imported_baselines"))).code, "delete").toBe(PERMISSION);
    }
  });

  test("an adjustment has one value, a whole period or none, a metric key of the right shape, and is unique per metric, split and period (a missing split counts as one)", async () => {
    const base = { organization_id: apex, metric_key: "reviews.count", period_start: null, period_end: null, integer_value: 3 };
    const bad: [Record<string, unknown>, string][] = [
      [{ integer_value: 3, money_cents: 5 }, "baselines_value"],
      [{ integer_value: null }, "baselines_value"],
      [{ period_start: "2024-10-01" }, "baselines_period"],
      [{ period_start: "2024-10-31", period_end: "2024-10-01" }, "baselines_period"],
      [{ metric_key: "Reviews Count" }, "baselines_metric_key"],
      [{ metric_key: "reviews" }, "baselines_metric_key"],
      [{ dimension: "" }, "baselines_dimension"],
    ];
    for (const [row, constraint] of bad) expect(await asOwner((c) => insertRow(c, "analytics_imported_baselines", { ...base, metric_key: "reviews.other", ...row })), JSON.stringify(row)).toMatchObject({ code: CHECK, constraint });
    // The same metric with no split and no period twice is a duplicate: NULLs count as equal.
    expect(await asOwner(async (c) => { await insertRow(c, "analytics_imported_baselines", { ...base, metric_key: "reviews.other" }); return insertRow(c, "analytics_imported_baselines", { ...base, metric_key: "reviews.other" }); })).toMatchObject({ code: UNIQUE, constraint: "baselines_unique" });
    // An adjustment is signed.
    expect((await asOwner((c) => insertRow(c, "analytics_imported_baselines", { ...base, metric_key: "reviews.other", integer_value: -5 }))).value).toBeTruthy();
    // And it cannot name a business that does not exist.
    expect((await asOwner((c) => insertRow(c, "analytics_imported_baselines", { ...base, organization_id: "00000000-0000-4000-8000-000000000000" }))).code).toBe(FOREIGN_KEY);
  });
});

/* ───────────────────────── the operations, committed ───────────────────────── */

type Fixtures = { workerTenant: { userId: string; organizationId: string } };

const content = (overrides: Partial<CampaignContent> = {}): CampaignContent => ({
  name: "Heat pump efficiency tips",
  channel: "email",
  audienceId: "all-customers",
  selectedCustomerIds: [],
  subject: "Get more from your heat pump",
  message: "Hi {{contact.first_name}}, a few tips.",
  ...overrides,
});

async function context(tx: Tx, organizationId: string, userId: string): Promise<MarketingContext> {
  return {
    tx,
    organizationId,
    timeZone: "America/Chicago",
    refs: await loadRefs(tx, organizationId),
    clock: { today: "2024-10-25", now: "2024-10-25T10:45" },
    stamp: localToInstant("2024-10-25T10:45", "America/Chicago"),
    actorUserId: userId,
  };
}

/** One operation in its own tenant transaction, the way a server action runs it. Resolves with the reference or the refusal. */
function operate<T>(tenant: Fixtures["workerTenant"], run: (ctx: MarketingContext) => Promise<T>): Promise<{ value: T } | { refused: string }> {
  return withTenant({ userId: tenant.userId, organizationId: tenant.organizationId }, async (tx) => run(await context(tx, tenant.organizationId, tenant.userId))).then(
    (value) => ({ value }),
    (error) => ({ refused: error instanceof Refusal ? error.message : String(error) }),
  );
}

const rowOf = async (organizationId: string, slug: string) => (await admin.query("select * from marketing_campaigns where organization_id = $1 and slug = $2", [organizationId, slug])).rows[0];
const snapshotOf = async (campaignId: string) => (await admin.query("select * from marketing_campaign_recipients where campaign_id = $1 order by position", [campaignId])).rows;

workerTest.describe("scheduling, sending, cancelling and duplicating a campaign", () => {
  workerTest("scheduling stores the status, the time as the business's own wall clock, the recipient count and a snapshot of who is in the audience", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const slug = await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-11-04T10:30"));
    expect(slug).toEqual({ value: "cmp-heat-pump-efficiency-tips" });
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    // 10:30 AM in Austin on Nov 4, 2024 is CST (UTC-6): the clocks went back on Nov 3.
    expect(row).toMatchObject({ status: "scheduled", recipient_count: 146, sent_on: null, sent_at: null, cancelled_at: null });
    expect(new Date(row.scheduled_for).toISOString()).toBe("2024-11-04T16:30:00.000Z");
    // The five customers with an email address are the snapshot; the other 141 recipients are the sample business's imported contacts.
    const people = await snapshotOf(row.id);
    expect(people.map((person) => person.recipient_name).sort()).toEqual(["Bradley Cooper", "David Chen", "Elena Rodriguez", "Hannah Wright", "Sarah Mitchell"]);
    expect(people.every((person) => person.status === "pending" && person.delivered_at === null && person.recipient_email)).toBe(true);
    const read = await withTenant({ userId: workerTenant.userId, organizationId: org }, async (tx) => (await loadMarketing(tx, org, "America/Chicago")).campaigns.find((campaign) => campaign.id === "cmp-heat-pump-efficiency-tips"));
    expect(read).toMatchObject({ status: "scheduled", scheduledFor: "2024-11-04T10:30", recipients: 146 });
  });

  workerTest("a business-local time is the same instant whatever the server's zone: the approved Oct 30, 9:00 AM is 14:00 UTC (CDT), and the seed stored it that way", async ({ workerTenant }) => {
    expect(new Date((await rowOf(workerTenant.organizationId, "cmp-fall-maintenance-reminder")).scheduled_for).toISOString()).toBe("2024-10-30T14:00:00.000Z");
    expect(new Date((await rowOf(workerTenant.organizationId, "cmp-cooling-tune-up-reminder")).sent_at).toISOString()).toBe("2024-10-18T15:15:00.000Z");
    // The same wall clock after the clocks went back is an hour later in UTC.
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-10-30T09:00"));
    expect(new Date((await rowOf(workerTenant.organizationId, "cmp-heat-pump-efficiency-tips")).scheduled_for).toISOString()).toBe("2024-10-30T14:00:00.000Z");
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "scheduled" }, content(), "2024-11-05T09:00"));
    expect(new Date((await rowOf(workerTenant.organizationId, "cmp-heat-pump-efficiency-tips")).scheduled_for).toISOString()).toBe("2024-11-05T15:00:00.000Z");
  });

  workerTest("a snapshot keeps the contact details a customer had when the campaign was scheduled; editing the customer later changes nothing in it", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-11-04T10:30"));
    const before = await snapshotOf((await rowOf(org, "cmp-heat-pump-efficiency-tips")).id);
    await admin.query("update customers set email = 'changed@example.test', name = 'Sarah Changed' where organization_id = $1 and slug = 'sarah-mitchell'", [org]);
    const after = await snapshotOf((await rowOf(org, "cmp-heat-pump-efficiency-tips")).id);
    expect(after).toEqual(before);
    const sarah = after.find((person) => person.recipient_email === "sarah.m@gmail.com");
    expect(sarah).toMatchObject({ recipient_name: "Sarah Mitchell" });
    const read = await withTenant({ userId: workerTenant.userId, organizationId: org }, (tx) => loadCampaignRecipients(tx, org, "America/Chicago", "cmp-heat-pump-efficiency-tips"));
    expect(read!.recipients.find((person) => person.customerId === "sarah-mitchell")).toMatchObject({ name: "Sarah Mitchell", email: "sarah.m@gmail.com" });
    expect(read!.total).toBe(146);
  });

  workerTest("scheduling a new campaign creates it, its snapshot and its count in one go; a failure after the work leaves nothing behind", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const created = await operate(workerTenant, (ctx) => scheduleTx(ctx, undefined, content({ name: "Brand new campaign" }), "2024-11-04T10:30"));
    expect(created).toEqual({ value: "cmp-brand-new-campaign" });
    const row = await rowOf(org, "cmp-brand-new-campaign");
    expect(row).toMatchObject({ status: "scheduled", recipient_count: 146 });
    expect(row.created_by).not.toBeNull();
    expect((await snapshotOf(row.id)).length).toBe(5);

    const before = (await admin.query("select count(*)::int as campaigns, (select count(*)::int from marketing_campaign_recipients where organization_id = $1) as people from marketing_campaigns where organization_id = $1", [org])).rows[0];
    await expect(
      withTenant({ userId: workerTenant.userId, organizationId: org }, async (tx) => {
        const ctx = await context(tx, org, workerTenant.userId);
        await scheduleTx(ctx, undefined, content({ name: "Rolled back" }), "2024-11-04T10:30");
        await sendTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content());
        throw new Error("the transaction fails after the work");
      }),
    ).rejects.toThrow("fails after");
    const after = (await admin.query("select count(*)::int as campaigns, (select count(*)::int from marketing_campaign_recipients where organization_id = $1) as people from marketing_campaigns where organization_id = $1", [org])).rows[0];
    expect(after).toEqual(before);
    expect((await rowOf(org, "cmp-heat-pump-efficiency-tips")).status).toBe("draft");
  });

  workerTest("cancelling a schedule makes the campaign a Draft again, keeps its content and count, removes the pending snapshot and never deletes it", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-11-04T10:30"));
    const scheduled = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(await operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-heat-pump-efficiency-tips"))).toEqual({ value: "cmp-heat-pump-efficiency-tips" });
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(row).toMatchObject({ id: scheduled.id, status: "draft", scheduled_for: null, recipient_count: 146, name: "Heat pump efficiency tips", subject: "Get more from your heat pump" });
    expect(row.cancelled_at).not.toBeNull();
    expect(new Date(row.cancelled_at).toISOString()).toBe("2024-10-25T15:45:00.000Z");
    expect(await snapshotOf(row.id)).toEqual([]);
    // Only a scheduled campaign can be cancelled.
    expect(await operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-heat-pump-efficiency-tips"))).toEqual({ refused: STALE_CAMPAIGN });
    expect(await operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-cooling-tune-up-reminder"))).toEqual({ refused: SENT_CAMPAIGN });
    expect(await operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-nobody"))).toEqual({ refused: GONE_CAMPAIGN });
  });

  workerTest("sending records the day and instant in the business's clock, the count and a snapshot, with no delivery result; a Sent campaign cannot be changed again", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    expect(await operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content()))).toEqual({ value: "cmp-heat-pump-efficiency-tips" });
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(row).toMatchObject({ status: "sent", recipient_count: 146, delivered_count: null, not_delivered_count: null, scheduled_for: null });
    expect(row.sent_on).toBeTruthy();
    expect(new Date(row.sent_at).toISOString()).toBe("2024-10-25T15:45:00.000Z");
    expect(await admin.query("select to_char(sent_on, 'YYYY-MM-DD') as day from marketing_campaigns where id = $1", [row.id]).then((result) => result.rows[0].day)).toBe("2024-10-25");
    expect((await snapshotOf(row.id)).length).toBe(5);

    for (const expected of ["draft", "scheduled"] as const) {
      expect(await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected }, content(), "2024-11-04T10:30"))).toEqual({ refused: SENT_CAMPAIGN });
      expect(await operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected }, content()))).toEqual({ refused: SENT_CAMPAIGN });
      expect(await operate(workerTenant, (ctx) => saveDraftTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected }, content({ name: "Changed" })))).toEqual({ refused: SENT_CAMPAIGN });
    }
    expect(await rowOf(org, "cmp-heat-pump-efficiency-tips")).toEqual(row);
  });

  workerTest("a request made for a campaign as it was is refused once the campaign has changed: a cancelled campaign cannot be sent by a stale request, a scheduled one cannot be scheduled by a stale draft", async ({ workerTenant }) => {
    expect(await operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-fall-maintenance-reminder"))).toEqual({ value: "cmp-fall-maintenance-reminder" });
    // The screen that sent this request saw the campaign Scheduled.
    expect(await operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-fall-maintenance-reminder", expected: "scheduled" }, content({ name: "Fall maintenance reminder" })))).toEqual({ refused: STALE_CAMPAIGN });
    expect((await rowOf(workerTenant.organizationId, "cmp-fall-maintenance-reminder")).status).toBe("draft");
    expect(await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-fall-maintenance-reminder", expected: "draft" }, content({ name: "Fall maintenance reminder" }), "2024-11-04T10:30"))).toEqual({ value: "cmp-fall-maintenance-reminder" });
    expect(await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-fall-maintenance-reminder", expected: "draft" }, content({ name: "Fall maintenance reminder" }), "2024-11-05T10:30"))).toEqual({ refused: STALE_CAMPAIGN });
  });

  workerTest("saving a Scheduled campaign as a draft cancels its send and removes its snapshot", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-11-04T10:30"));
    expect(await operate(workerTenant, (ctx) => saveDraftTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "scheduled" }, content({ name: "Renamed tips" })))).toEqual({ value: "cmp-heat-pump-efficiency-tips" });
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(row).toMatchObject({ status: "draft", name: "Renamed tips", scheduled_for: null });
    expect(row.cancelled_at).not.toBeNull();
    expect(await snapshotOf(row.id)).toEqual([]);
  });

  workerTest("duplicating any campaign, a Sent one included, makes a new Draft with no schedule, no sent time, no delivery result and no recipients; the original is untouched", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const original = await rowOf(org, "cmp-cooling-tune-up-reminder");
    const originalPeople = await snapshotOf(original.id);
    expect(await operate(workerTenant, (ctx) => duplicateTx(ctx, "cmp-cooling-tune-up-reminder"))).toEqual({ value: "cmp-cooling-tune-up-reminder-copy" });
    expect(await operate(workerTenant, (ctx) => duplicateTx(ctx, "cmp-cooling-tune-up-reminder"))).toEqual({ value: "cmp-cooling-tune-up-reminder-copy-2" });
    const copy = await rowOf(org, "cmp-cooling-tune-up-reminder-copy");
    expect(copy).toMatchObject({
      name: "Cooling tune-up reminder (copy)",
      summary: original.summary,
      status: "draft",
      channel: "sms",
      audience_id: "maintenance-customers",
      message: original.message,
      scheduled_for: null,
      sent_at: null,
      sent_on: null,
      cancelled_at: null,
      delivered_count: null,
      not_delivered_count: null,
    });
    expect(copy.recipient_count).toBe(42);
    expect(copy.id).not.toBe(original.id);
    expect(await snapshotOf(copy.id)).toEqual([]);
    expect(await rowOf(org, "cmp-cooling-tune-up-reminder")).toEqual(original);
    expect(await snapshotOf(original.id)).toEqual(originalPeople);
    // A duplicate of a campaign that does not exist, or of another business's, is refused.
    expect(await operate(workerTenant, (ctx) => duplicateTx(ctx, "cmp-furnace-tune-up-season-notice"))).toEqual({ refused: GONE_CAMPAIGN });
  });

  workerTest("the customers chosen for a campaign are replaced while it is a Draft or Scheduled and frozen once it is Sent", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const chosen = async (slug: string) => (await admin.query("select c.slug from marketing_campaign_selected_customers s join customers c on c.id = s.customer_id where s.campaign_id = (select id from marketing_campaigns where organization_id = $1 and slug = $2) order by s.position", [org, slug])).rows.map((row) => row.slug);
    await operate(workerTenant, (ctx) => saveDraftTx(ctx, undefined, content({ name: "Chosen few", audienceId: "selected", selectedCustomerIds: ["sarah-mitchell", "david-chen"] })));
    expect(await chosen("cmp-chosen-few")).toEqual(["sarah-mitchell", "david-chen"]);
    await operate(workerTenant, (ctx) => saveDraftTx(ctx, { slug: "cmp-chosen-few", expected: "draft" }, content({ name: "Chosen few", audienceId: "selected", selectedCustomerIds: ["hannah-wright"] })));
    expect(await chosen("cmp-chosen-few")).toEqual(["hannah-wright"]);
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-chosen-few", expected: "draft" }, content({ name: "Chosen few", audienceId: "selected", selectedCustomerIds: ["sarah-mitchell"] }), "2024-11-04T10:30"));
    expect(await chosen("cmp-chosen-few")).toEqual(["sarah-mitchell"]);
    expect((await snapshotOf((await rowOf(org, "cmp-chosen-few")).id)).map((person) => person.recipient_name)).toEqual(["Sarah Mitchell"]);
    expect((await rowOf(org, "cmp-chosen-few")).recipient_count).toBe(1);
    await operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-chosen-few", expected: "scheduled" }, content({ name: "Chosen few", audienceId: "selected", selectedCustomerIds: ["sarah-mitchell", "david-chen"] })));
    expect(await chosen("cmp-chosen-few")).toEqual(["sarah-mitchell", "david-chen"]);
    // Sent: the database refuses to add or drop one, for the owner as for anyone.
    const campaign = (await rowOf(org, "cmp-chosen-few")).id;
    const david = (await admin.query("select id from customers where organization_id = $1 and slug = 'hannah-wright'", [org])).rows[0].id;
    const add = await as(workerTenant.userId, org, (c) => insertRow(c, "marketing_campaign_selected_customers", { organization_id: org, campaign_id: campaign, customer_id: david }));
    expect(add.code).toBe(PERMISSION);
    const drop = await as(workerTenant.userId, org, async (c) => (await c.query("delete from marketing_campaign_selected_customers where campaign_id = $1", [campaign])).rowCount);
    expect(drop.value).toBe(0);
    expect(await chosen("cmp-chosen-few")).toEqual(["sarah-mitchell", "david-chen"]);
  });

  workerTest("an audience with no one to reach cannot be scheduled or sent, and a customer of another business cannot be chosen", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    // A text message to a customer who has no phone number reaches no one.
    await admin.query("update customers set phone = null where organization_id = $1 and slug = 'david-chen'", [org]);
    const nobody = content({ channel: "sms", subject: null, audienceId: "selected", selectedCustomerIds: ["david-chen"], message: "Hi" });
    expect(await operate(workerTenant, (ctx) => scheduleTx(ctx, undefined, nobody, "2024-11-04T10:30"))).toEqual({ refused: "No customers match this audience, so there is no one to send to." });
    expect(await operate(workerTenant, (ctx) => sendTx(ctx, undefined, nobody))).toEqual({ refused: "No customers match this audience, so there is no one to send to." });
    // Marta Olsen is Northstar's customer: the Apex transaction does not know her.
    const foreign = content({ audienceId: "selected", selectedCustomerIds: ["marta-olsen"] });
    for (const run of [(ctx: MarketingContext) => scheduleTx(ctx, undefined, foreign, "2024-11-04T10:30"), (ctx: MarketingContext) => sendTx(ctx, undefined, foreign), (ctx: MarketingContext) => saveDraftTx(ctx, undefined, foreign)]) {
      expect(await operate(workerTenant, run)).toEqual({ refused: "One of the chosen customers is not in your customers any more. Reload the page and choose again." });
    }
    expect((await admin.query("select count(*)::int as n from marketing_campaigns where organization_id = $1", [org])).rows[0].n).toBe(11);
  });

  workerTest("each audience is worked out from the business's own customers, jobs and plans, and the sample business's imported contacts are counted, not listed", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    await withTenant({ userId: workerTenant.userId, organizationId: org }, async (tx) => {
      const names = async (channel: "email" | "sms", audience: Parameters<typeof resolveAudience>[4], selected: string[] = []) => {
        const result = await resolveAudience(tx, org, "2024-10-25", channel, audience, selected);
        return { people: result.contacts.map((contact) => contact.slug), total: result.total };
      };
      expect(await names("email", "all-customers")).toEqual({ people: ["sarah-mitchell", "david-chen", "elena-rodriguez", "bradley-cooper", "hannah-wright"], total: 146 });
      expect(await names("email", "due-for-maintenance")).toEqual({ people: [], total: 38 });
      expect(await names("sms", "maintenance-customers")).toEqual({ people: ["sarah-mitchell", "david-chen"], total: 42 });
      expect(await names("email", "active-plans")).toEqual({ people: ["sarah-mitchell", "david-chen"], total: 18 });
      expect(await names("email", "selected", ["david-chen", "hannah-wright", "marta-olsen"])).toEqual({ people: ["david-chen", "hannah-wright"], total: 2 });
      expect(await names("email", "selected")).toEqual({ people: [], total: 0 });
      expect(await loadAudienceSizes(tx, org, "2024-10-25")).toEqual({
        email: { "all-customers": 146, "due-for-maintenance": 38, "maintenance-customers": 42, "active-plans": 18 },
        sms: { "all-customers": 146, "due-for-maintenance": 38, "maintenance-customers": 42, "active-plans": 18 },
      });
    });
    // A customer with no phone number is not in an SMS audience, and one with no email is not in an email audience.
    await admin.query("update customers set phone = null where organization_id = $1 and slug = 'elena-rodriguez'", [org]);
    await admin.query("update customers set email = '  ' where organization_id = $1 and slug = 'bradley-cooper'", [org]);
    await withTenant({ userId: workerTenant.userId, organizationId: org }, async (tx) => {
      expect((await resolveAudience(tx, org, "2024-10-25", "sms", "all-customers", [])).contacts.map((contact) => contact.slug)).not.toContain("elena-rodriguez");
      expect((await resolveAudience(tx, org, "2024-10-25", "email", "all-customers", [])).contacts.map((contact) => contact.slug)).not.toContain("bradley-cooper");
    });
  });
});

workerTest.describe("campaigns raced against each other", () => {
  workerTest("six requests to schedule the same Draft at once: exactly one transition, one snapshot, no duplicate rows", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const outcomes = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((index) => operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), `2024-11-0${index + 1}T10:30`))),
    );
    expect(outcomes.filter((outcome) => "value" in outcome)).toHaveLength(1);
    expect(outcomes.filter((outcome) => "refused" in outcome).map((outcome) => (outcome as { refused: string }).refused)).toEqual(Array(5).fill(STALE_CAMPAIGN));
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(row.status).toBe("scheduled");
    const people = await snapshotOf(row.id);
    expect(people).toHaveLength(5);
    expect(new Set(people.map((person) => person.customer_id)).size).toBe(5);
  });

  workerTest("scheduling and sending the same Draft at once: one of them wins, the other is refused, and the campaign holds exactly one snapshot", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const outcomes = await Promise.all([
      operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-11-04T10:30")),
      operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content())),
      operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content())),
    ]);
    expect(outcomes.filter((outcome) => "value" in outcome)).toHaveLength(1);
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(["scheduled", "sent"]).toContain(row.status);
    expect(await snapshotOf(row.id)).toHaveLength(5);
    // Whatever won, what it did is whole: a Sent campaign has its day and no time to wait for; a Scheduled one has its time and no sent day.
    if (row.status === "sent") expect(row).toMatchObject({ scheduled_for: null });
    else expect(row).toMatchObject({ sent_on: null, sent_at: null });
  });

  workerTest("four requests to cancel the same schedule at once: one cancels it, the others are refused, and no snapshot is left behind", async ({ workerTenant }) => {
    const outcomes = await Promise.all([0, 1, 2, 3].map(() => operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-fall-maintenance-reminder"))));
    expect(outcomes.filter((outcome) => "value" in outcome)).toHaveLength(1);
    expect(outcomes.filter((outcome) => "refused" in outcome).map((outcome) => (outcome as { refused: string }).refused)).toEqual(Array(3).fill(STALE_CAMPAIGN));
    const row = await rowOf(workerTenant.organizationId, "cmp-fall-maintenance-reminder");
    expect(row).toMatchObject({ status: "draft", scheduled_for: null });
    expect(await snapshotOf(row.id)).toEqual([]);
  });

  workerTest("a reschedule and a cancel of the same Scheduled campaign at once leave it either Scheduled with one snapshot or a Draft with none, never both", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    await operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content(), "2024-11-04T10:30"));
    await Promise.all([
      operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "scheduled" }, content(), "2024-11-06T10:30")),
      operate(workerTenant, (ctx) => cancelScheduleTx(ctx, "cmp-heat-pump-efficiency-tips")),
      operate(workerTenant, (ctx) => scheduleTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "scheduled" }, content(), "2024-11-07T10:30")),
    ]);
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    const people = await snapshotOf(row.id);
    if (row.status === "scheduled") expect(people).toHaveLength(5);
    else {
      expect(row.status).toBe("draft");
      expect(people).toEqual([]);
    }
  });

  workerTest("six duplicates of the same campaign at once are six independent Drafts with their own references", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const outcomes = await Promise.all([0, 1, 2, 3, 4, 5].map(() => operate(workerTenant, (ctx) => duplicateTx(ctx, "cmp-cooling-tune-up-reminder"))));
    const slugs = outcomes.map((outcome) => ("value" in outcome ? outcome.value : outcome.refused));
    expect([...slugs].sort()).toEqual(["cmp-cooling-tune-up-reminder-copy", ...[2, 3, 4, 5, 6].map((suffix) => `cmp-cooling-tune-up-reminder-copy-${suffix}`)].sort());
    const copies = (await admin.query("select * from marketing_campaigns where organization_id = $1 and slug like 'cmp-cooling-tune-up-reminder-copy%'", [org])).rows;
    expect(copies).toHaveLength(6);
    expect(new Set(copies.map((copy) => copy.id)).size).toBe(6);
    for (const copy of copies) expect(copy).toMatchObject({ status: "draft", sent_at: null, sent_on: null, delivered_count: null, scheduled_for: null, name: "Cooling tune-up reminder (copy)" });
  });

  workerTest("a campaign cannot be marked Sent twice, and nothing is sent twice by a double click", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const outcomes = await Promise.all([0, 1, 2, 3, 4, 5].map(() => operate(workerTenant, (ctx) => sendTx(ctx, { slug: "cmp-heat-pump-efficiency-tips", expected: "draft" }, content()))));
    expect(outcomes.filter((outcome) => "value" in outcome)).toHaveLength(1);
    const row = await rowOf(org, "cmp-heat-pump-efficiency-tips");
    expect(row.status).toBe("sent");
    expect(await snapshotOf(row.id)).toHaveLength(5);
  });
});
