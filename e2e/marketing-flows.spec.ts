/**
 * Phase 14: Marketing as a person uses it, with the campaigns, recipients and results stored in PostgreSQL per business.
 *
 * Each test signs in as the owner of the worker's own copy of the Apex business (restored before every test), so a campaign it makes,
 * schedules, sends, cancels or copies is checked in the database as well as on the screen, and a reload proves it was stored. The
 * forged and stale requests go through the real Server Actions, captured from the screen and replayed with other arguments, as another
 * person or with no session. The standing Apex and Northstar businesses are only ever read.
 */
import type { Page } from "playwright/test";
import { captureAction, replay, withFirstArgument } from "./replay";
import { NOT_SIGNED_IN, completeOnboarding, expect, hydrated, signUp, test, waitsForHydration } from "./saas";

const main = (page: Page) => page.getByRole("main");
const toast = (page: Page) => page.getByRole("status");
const totals = (page: Page) => page.getByRole("region", { name: "Campaign totals" });
const tabCounts = (page: Page) => page.getByRole("tablist", { name: "Campaign views" }).getByRole("tab");
const rows = (page: Page) => page.getByRole("table", { name: "Campaigns" }).locator("tbody tr");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });

const STALE = "This campaign has changed since you opened it. Reload the page and try again.";
const NOT_ALLOWED = "Only an owner or admin can create or change marketing campaigns.";

async function compose(page: Page, name: string, audience?: RegExp) {
  await page.goto("/marketing/new");
  await page.getByLabel(/^Campaign name/).fill(name);
  if (audience) await page.getByRole("radio", { name: audience }).check();
}

async function toReview(page: Page) {
  await page.getByRole("button", { name: /^Continue to review/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review & schedule campaign" })).toBeVisible();
}

type Row = Record<string, unknown> & { id: string };
const campaign = async (db: import("pg").Pool, organizationId: string, slug: string): Promise<Row | undefined> =>
  (await db.query("select * from marketing_campaigns where organization_id = $1 and slug = $2", [organizationId, slug])).rows[0];
const people = async (db: import("pg").Pool, id: string) => (await db.query("select * from marketing_campaign_recipients where campaign_id = $1 order by position", [id])).rows;

test.describe("a draft is stored", () => {
  test("Save draft stores it for this business; a reload keeps it; editing and saving again changes the same campaign", async ({ page, db, workerTenant }) => {
    await compose(page, "Persisted draft");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-persisted-draft");
    await expect(toast(page)).toContainText("Draft saved.");

    const stored = await campaign(db, workerTenant.organizationId, "cmp-persisted-draft");
    expect(stored).toMatchObject({ name: "Persisted draft", status: "draft", channel: "email", audience_id: "due-for-maintenance", scheduled_for: null, sent_at: null, delivered_count: null });
    expect(stored!.created_by).not.toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Persisted draft" })).toBeVisible();
    await page.goto("/marketing");
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*12$/, /^Drafts\s*3$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);

    await page.goto("/marketing/cmp-persisted-draft/edit");
    await expect(page.getByLabel(/^Campaign name/)).toHaveValue("Persisted draft");
    await page.getByLabel(/^Campaign name/).fill("Persisted draft, edited");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-persisted-draft");
    await expect(page.getByRole("heading", { level: 1, name: "Persisted draft, edited" })).toBeVisible();
    expect((await db.query("select count(*)::int as n from marketing_campaigns where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(12);
  });

  test("a draft with chosen customers stores them, and they come back when it is opened", async ({ page, db, workerTenant }) => {
    await compose(page, "Two customers", /^Selected customers/);
    await page.getByRole("checkbox", { name: /Sarah Mitchell/ }).check();
    await page.getByRole("checkbox", { name: /David Chen/ }).check();
    await expect(page.getByText("2 recipients", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-two-customers");
    const chosen = (await db.query("select c.slug from marketing_campaign_selected_customers s join customers c on c.id = s.customer_id where s.organization_id = $1 order by s.position", [workerTenant.organizationId])).rows.map((r) => r.slug);
    expect(chosen).toEqual(["sarah-mitchell", "david-chen"]);
    await page.goto("/marketing/cmp-two-customers/edit");
    await expect(page.getByRole("checkbox", { name: /Sarah Mitchell/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /David Chen/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Elena Rodriguez/ })).not.toBeChecked();
  });
});

test.describe("scheduling a campaign", () => {
  test("stores the status, the business-local time, the count and a snapshot of who is in the audience; the recipients dialog reads that snapshot", async ({ page, db, workerTenant }) => {
    await compose(page, "Snapshot test", /^All customers/);
    await toReview(page);
    await expect(page.getByLabel(/^Date/)).toHaveValue("2024-10-30");
    await expect(page.getByLabel(/^Time/)).toHaveValue("09:00");
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-snapshot-test");
    await expect(toast(page)).toContainText("Campaign scheduled for Oct 30, 2024 · 9:00 AM.");

    const stored = (await campaign(db, workerTenant.organizationId, "cmp-snapshot-test"))!;
    expect(stored).toMatchObject({ status: "scheduled", recipient_count: 146, sent_at: null, cancelled_at: null });
    // 9:00 AM on Oct 30 in Austin is CDT (UTC-5).
    expect(new Date(stored.scheduled_for as string).toISOString()).toBe("2024-10-30T14:00:00.000Z");
    const snapshot = await people(db, stored.id);
    expect(snapshot.map((person) => person.recipient_name)).toEqual(["Sarah Mitchell", "David Chen", "Elena Rodriguez", "Bradley Cooper", "Hannah Wright"]);

    await page.reload();
    await expect(main(page)).toContainText("Oct 30, 2024 · 9:00 AM");
    await page.getByRole("button", { name: "View recipients" }).click();
    const dialog = page.getByRole("dialog", { name: "Recipients" });
    await expect(dialog).toContainText("All customers · 146 recipients");
    await expect(dialog).toContainText("Sarah Mitchell");
    await expect(dialog).toContainText("sarah.m@gmail.com");
    await expect(dialog).toContainText("Showing 5 sample records of 146 recipients.");
    await expect(dialog).toContainText("These are the contact details the campaign was scheduled with.");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    // A customer edited afterwards does not rewrite who the campaign was for.
    await db.query("update customers set email = 'changed@example.test', name = 'Sarah Changed' where organization_id = $1 and slug = 'sarah-mitchell'", [workerTenant.organizationId]);
    await page.reload();
    await page.getByRole("button", { name: "View recipients" }).click();
    await expect(page.getByRole("dialog", { name: "Recipients" })).toContainText("sarah.m@gmail.com");
    await expect(page.getByRole("dialog", { name: "Recipients" })).toContainText("Sarah Mitchell");
    await expect(page.getByRole("dialog", { name: "Recipients" })).not.toContainText("changed@example.test");
  });

  test("a time is the business's own whatever the browser's time zone is: the same Nov 4, 9:00 AM is stored as 15:00 UTC (CST) from any zone", async ({ browser, storageState, db, workerTenant }) => {
    for (const [index, timezoneId] of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"].entries()) {
      const context = await browser.newContext({ timezoneId, storageState });
      const page = waitsForHydration(await context.newPage());
      try {
        const name = `Zone test ${index}`;
        await compose(page, name, /^All customers/);
        await toReview(page);
        await page.getByLabel(/^Date/).fill("2024-11-04");
        await page.getByLabel(/^Time/).fill("09:00");
        await page.getByRole("button", { name: "Schedule campaign" }).click();
        await expect(page).toHaveURL(`/marketing/cmp-zone-test-${index}`);
        await expect(main(page)).toContainText("Nov 4, 2024 · 9:00 AM");
        await expect(main(page)).toContainText("Central Time (CT)");
        const stored = await campaign(db, workerTenant.organizationId, `cmp-zone-test-${index}`);
        expect(new Date(stored!.scheduled_for as string).toISOString(), timezoneId).toBe("2024-11-04T15:00:00.000Z");
      } finally {
        await context.close();
      }
    }
  });

  test("the date and time are checked on the server in the business's own clock: yesterday and an earlier time today are refused with the screen's words", async ({ page, db, workerTenant }) => {
    await compose(page, "Clock test", /^All customers/);
    await toReview(page);
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Schedule campaign" }).click());
    await expect(page).toHaveURL("/marketing/cmp-clock-test");
    const api = page.context().request;
    for (const [timing, message] of [
      [{ mode: "later", date: "2024-10-24", time: "09:00" }, "Choose today or a later date."],
      [{ mode: "later", date: "2024-10-25", time: "09:00" }, "Choose a time later than now."],
      [{ mode: "later", date: "2024-10-30", time: "25:00" }, "Choose the time to send."],
      [{ mode: "later", date: "2031-10-30", time: "09:00" }, "Choose a date within the next two years."],
      [{ mode: "whenever" }, "The send time was not understood."],
    ] as const) {
      const response = await replay(api, captured, withFirstArgument(captured, (args) => {
        args.expectedStatus = "scheduled";
        args.timing = timing;
      }));
      expect(await response.text(), JSON.stringify(timing)).toContain(message);
    }
    // Nothing moved.
    const stored = (await campaign(db, workerTenant.organizationId, "cmp-clock-test"))!;
    expect(new Date(stored.scheduled_for as string).toISOString()).toBe("2024-10-30T14:00:00.000Z");
  });

  test("a campaign can be rescheduled, which replaces the snapshot rather than adding to it", async ({ page, db, workerTenant }) => {
    await compose(page, "Reschedule me", /^All customers/);
    await toReview(page);
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-reschedule-me");
    const first = (await campaign(db, workerTenant.organizationId, "cmp-reschedule-me"))!;
    expect(await people(db, first.id)).toHaveLength(5);

    await page.getByRole("link", { name: "Edit campaign" }).click();
    await toReview(page);
    await page.getByLabel(/^Date/).fill("2024-11-08");
    await page.getByLabel(/^Time/).fill("14:15");
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-reschedule-me");
    await expect(main(page)).toContainText("Nov 8, 2024 · 2:15 PM");
    const second = (await campaign(db, workerTenant.organizationId, "cmp-reschedule-me"))!;
    expect(second.id).toBe(first.id);
    expect(new Date(second.scheduled_for as string).toISOString()).toBe("2024-11-08T20:15:00.000Z");
    expect(await people(db, second.id)).toHaveLength(5);
  });

  test("chosen customers who cannot receive it say so before it goes on, and no campaign is made", async ({ page, db, workerTenant }) => {
    await db.query("update customers set email = null where organization_id = $1 and slug = 'sarah-mitchell'", [workerTenant.organizationId]);
    await compose(page, "Nobody home", /^Selected customers/);
    await page.getByRole("checkbox", { name: /Sarah Mitchell/ }).check();
    await expect(page.getByText("No recipients yet")).toBeVisible();
    await page.getByRole("button", { name: /^Continue to review/ }).click();
    await expect(page.getByText("None of the chosen customers has an email address.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Create campaign" })).toBeVisible();
    expect((await db.query("select count(*)::int as n from marketing_campaigns where organization_id = $1 and slug = 'cmp-nobody-home'", [workerTenant.organizationId])).rows[0].n).toBe(0);
  });
});

test.describe("sending and cancelling", () => {
  test("Send now records the day, the count and the snapshot, with no delivery result and nothing delivered", async ({ page, db, workerTenant }) => {
    await compose(page, "Sent for real", /^All customers/);
    await toReview(page);
    await page.getByRole("radio", { name: /^Send now/ }).check();
    await page.getByRole("button", { name: "Send campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-sent-for-real");
    await expect(toast(page)).toContainText("Campaign recorded as sent to 146 recipients. Nothing was delivered.");

    const stored = (await campaign(db, workerTenant.organizationId, "cmp-sent-for-real"))!;
    expect(stored).toMatchObject({ status: "sent", recipient_count: 146, delivered_count: null, not_delivered_count: null, scheduled_for: null });
    expect(new Date(stored.sent_at as string).toISOString()).toBe("2024-10-25T15:45:00.000Z");
    expect(await people(db, stored.id)).toHaveLength(5);

    await page.reload();
    await expect(main(page)).toContainText("Oct 25, 2024 · 10:45 AM");
    await expect(main(page)).toContainText("Delivery records aren’t kept for this campaign.");
    await expect(page.getByRole("button", { name: "Duplicate campaign" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit campaign" })).toHaveCount(0);
    await page.getByRole("button", { name: "View recipients" }).click();
    await expect(page.getByRole("dialog", { name: "Recipients" })).toContainText("Showing 5 sample records of 146 recipients.");
    await page.keyboard.press("Escape");

    // The Marketing totals follow the stored campaigns: one more Sent, and 146 more recent recipients.
    await page.goto("/marketing");
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*12$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*9$/]);
    await expect(totals(page)).toContainText("292");
  });

  test("cancelling a schedule keeps the campaign as a Draft, with its content and count, and removes only the snapshot; it is stored", async ({ page, db, workerTenant }) => {
    await compose(page, "Cancel me", /^All customers/);
    await toReview(page);
    await page.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cancel-me");
    const scheduled = (await campaign(db, workerTenant.organizationId, "cmp-cancel-me"))!;
    expect(await people(db, scheduled.id)).toHaveLength(5);

    await page.getByRole("button", { name: "Cancel scheduled send" }).click();
    await page.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
    await expect(toast(page)).toContainText("Scheduled send cancelled. The campaign is now a Draft.");

    const cancelled = (await campaign(db, workerTenant.organizationId, "cmp-cancel-me"))!;
    expect(cancelled).toMatchObject({ id: scheduled.id, status: "draft", scheduled_for: null, recipient_count: 146, name: "Cancel me" });
    expect(cancelled.cancelled_at).not.toBeNull();
    expect(await people(db, cancelled.id)).toEqual([]);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Cancel me" }).locator("..")).toContainText("Draft");
    await expect(page.getByRole("region", { name: "Campaign summary" })).toContainText("Not scheduled");
    await expect(page.getByRole("region", { name: "Campaign summary" })).toContainText("146");
  });

  test("duplicating a Sent campaign makes a new Draft with no sent time, no delivery result and no recipients, and leaves the original and its results alone", async ({ page, db, workerTenant }) => {
    const before = (await campaign(db, workerTenant.organizationId, "cmp-cooling-tune-up-reminder"))!;
    const snapshotBefore = await people(db, before.id);
    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    await page.getByRole("button", { name: "Duplicate campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder-copy");
    await expect(toast(page)).toContainText("Draft created from Cooling tune-up reminder.");
    await expect(page.getByRole("heading", { level: 1, name: "Cooling tune-up reminder (copy)" })).toBeVisible();

    const copy = (await campaign(db, workerTenant.organizationId, "cmp-cooling-tune-up-reminder-copy"))!;
    expect(copy).toMatchObject({ status: "draft", scheduled_for: null, sent_at: null, sent_on: null, cancelled_at: null, delivered_count: null, not_delivered_count: null, channel: "sms", audience_id: "maintenance-customers" });
    expect(await people(db, copy.id)).toEqual([]);
    expect(await campaign(db, workerTenant.organizationId, "cmp-cooling-tune-up-reminder")).toEqual(before);
    expect(await people(db, before.id)).toEqual(snapshotBefore);

    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    await expect(page.getByRole("region", { name: "Campaign results" })).toContainText("40");
    await page.getByRole("button", { name: "Duplicate campaign" }).click();
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder-copy-2");
  });

  test("the sent campaign with a recorded result lists its recipients with the result for each, from the stored snapshot", async ({ page }) => {
    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    const records = page.getByRole("table", { name: "Delivery records" });
    await expect(records.locator("tbody tr")).toHaveCount(6);
    await expect(records.locator("tbody tr", { hasText: "Linda Zhao" })).toContainText("Not delivered");
    await expect(records.locator("tbody tr", { hasText: "Sarah Mitchell" }).getByRole("link", { name: "Sarah Mitchell" })).toHaveAttribute("href", "/customers/sarah-mitchell");
    await expect(page.getByText("Showing 6 sample records of 42 recipients")).toBeVisible();
  });
});

test.describe("a stale screen changes nothing twice", () => {
  test("cancelling from a screen that was opened before the schedule was cancelled elsewhere is refused and says why", async ({ browser, storageState, db, workerTenant }) => {
    const first = await browser.newContext({ storageState });
    const second = await browser.newContext({ storageState });
    try {
      const one = waitsForHydration(await first.newPage());
      const two = waitsForHydration(await second.newPage());
      await one.goto("/marketing/cmp-fall-maintenance-reminder");
      await two.goto("/marketing/cmp-fall-maintenance-reminder");
      await one.getByRole("button", { name: "Cancel scheduled send" }).click();
      await one.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
      await expect(toast(one)).toContainText("Scheduled send cancelled.");

      await two.getByRole("button", { name: "Cancel scheduled send" }).click();
      await two.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
      await expect(main(two).getByRole("alert")).toContainText(STALE);
      expect((await campaign(db, workerTenant.organizationId, "cmp-fall-maintenance-reminder"))!.status).toBe("draft");
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("sending from an editor opened while the campaign was Scheduled is refused once it has been cancelled", async ({ browser, storageState, db, workerTenant }) => {
    const first = await browser.newContext({ storageState });
    const second = await browser.newContext({ storageState });
    try {
      const editor = waitsForHydration(await first.newPage());
      const other = waitsForHydration(await second.newPage());
      await editor.goto("/marketing/cmp-fall-maintenance-reminder/edit");
      await editor.getByRole("button", { name: /^Continue to review/ }).click();
      await editor.getByRole("radio", { name: /^Send now/ }).check();

      await other.goto("/marketing/cmp-fall-maintenance-reminder");
      await other.getByRole("button", { name: "Cancel scheduled send" }).click();
      await other.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
      await expect(toast(other)).toContainText("Scheduled send cancelled.");

      await editor.getByRole("button", { name: "Send campaign" }).click();
      await expect(main(editor).getByRole("alert")).toContainText(STALE);
      await expect(editor).toHaveURL("/marketing/cmp-fall-maintenance-reminder/edit");
      const stored = (await campaign(db, workerTenant.organizationId, "cmp-fall-maintenance-reminder"))!;
      expect(stored).toMatchObject({ status: "draft", sent_on: null });
    } finally {
      await first.close();
      await second.close();
    }
  });
});

test.describe("forged and replayed requests", () => {
  test("the server reads only the campaign and the time; an organization named in the request is ignored, and what the screen would not send is refused", async ({ page, db, workerTenant, apiAs }) => {
    // A saved Draft, scheduled from its editor: the request names the campaign and the status the screen saw it in.
    await compose(page, "Forged", /^All customers/);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-forged");
    await page.goto("/marketing/cmp-forged/edit");
    await toReview(page);
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Schedule campaign" }).click());
    await expect(page).toHaveURL("/marketing/cmp-forged");
    expect((await campaign(db, workerTenant.organizationId, "cmp-forged"))!.status).toBe("scheduled");
    const api = page.context().request;
    const northstar = (await db.query("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id as string;
    const northstarCampaigns = async () => (await db.query("select count(*)::int as n from marketing_campaigns where organization_id = $1", [northstar])).rows[0].n as number;
    const before = await northstarCampaigns();

    const send = async (change: (args: Record<string, unknown>) => void) => (await replay(api, captured, withFirstArgument(captured, change))).text();
    // The same request again: the campaign is no longer a Draft.
    expect(await send(() => undefined)).toContain(STALE);
    // A request that does not say what status it saw, or says one that cannot be changed.
    expect(await send((args) => delete args.expectedStatus)).toContain(STALE);
    expect(await send((args) => (args.expectedStatus = "sent"))).toContain("A sent campaign can’t be changed");
    // Another business's campaign is no campaign of this one.
    expect(await send((args) => ((args.id = "cmp-furnace-tune-up-season-notice"), (args.expectedStatus = "draft")))).toContain("That campaign no longer exists");
    // Content the screen would never send.
    expect(await send((args) => ((args.expectedStatus = "scheduled"), ((args.campaign as Record<string, unknown>).channel = "fax")))).toContain("The campaign was not understood");
    expect(await send((args) => ((args.expectedStatus = "scheduled"), ((args.campaign as Record<string, unknown>).audienceId = "everyone")))).toContain("The campaign was not understood");
    expect(await send((args) => ((args.expectedStatus = "scheduled"), ((args.campaign as Record<string, unknown>).message = "x".repeat(6000))))).toContain("Keep the message to 5000 characters or fewer.");
    expect(await send((args) => ((args.expectedStatus = "scheduled"), ((args.campaign as Record<string, unknown>).name = "   ")))).toContain("Enter a campaign name.");
    // A customer of another business cannot be chosen.
    expect(await send((args) => {
      args.expectedStatus = "scheduled";
      Object.assign(args.campaign as Record<string, unknown>, { audienceId: "selected", selectedCustomerIds: ["marta-olsen"] });
    })).toContain("One of the chosen customers is not in your customers any more");
    // An organization named in the request is not read: this campaign stays where it is, and Northstar gets nothing.
    await send((args) => {
      args.organizationId = northstar;
      args.expectedStatus = "scheduled";
      (args.campaign as Record<string, unknown>).organizationId = northstar;
    });
    expect(await northstarCampaigns()).toBe(before);
    expect((await campaign(db, workerTenant.organizationId, "cmp-forged"))!.status).toBe("scheduled");

    // Someone who may only read (Jamie, a member of the standing Apex business) cannot write, and the standing business is untouched.
    const jamie = await apiAs("jamie");
    const standing = async () => (await db.query("select count(*)::int as n from marketing_campaigns where organization_id = (select id from organizations where slug = 'apex-climate-heating-air')")).rows[0].n as number;
    const standingBefore = await standing();
    expect(await (await replay(jamie, captured)).text()).toContain(NOT_ALLOWED);
    expect(await (await replay(jamie, captured, withFirstArgument(captured, (args) => delete args.id))).text()).toContain(NOT_ALLOWED);
    expect(await standing()).toBe(standingBefore);
    // And with no session at all: the request is turned away before an action runs.
    const anonymous = await apiAs(null);
    expect([307, 401, 403]).toContain((await replay(anonymous, captured, captured.body, { maxRedirects: 0 })).status());
    expect((await campaign(db, workerTenant.organizationId, "cmp-forged"))!.status).toBe("scheduled");
  });

  test("cancelling and duplicating are refused for what they cannot act on, and for the wrong person", async ({ page, db, workerTenant, apiAs }) => {
    await page.goto("/marketing/cmp-fall-maintenance-reminder");
    const cancel = await captureAction(page, async () => {
      await page.getByRole("button", { name: "Cancel scheduled send" }).click();
      await page.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
    });
    await expect(toast(page)).toContainText("Scheduled send cancelled.");
    const api = page.context().request;
    // Cancelled once: the same request again changes nothing.
    expect(await (await replay(api, cancel)).text()).toContain(STALE);
    // A campaign that was sent cannot be cancelled, one that does not exist (or is another business's) cannot either.
    expect(await (await replay(api, cancel, withFirstArgument(cancel, (args) => (args.id = "cmp-cooling-tune-up-reminder")))).text()).toContain("A sent campaign can’t be changed");
    expect(await (await replay(api, cancel, withFirstArgument(cancel, (args) => (args.id = "cmp-furnace-tune-up-season-notice")))).text()).toContain("That campaign no longer exists");
    expect(await (await replay(api, cancel, withFirstArgument(cancel, (args) => (args.id = "../../x")))).text()).toContain("The campaign was not understood");
    expect((await campaign(db, workerTenant.organizationId, "cmp-cooling-tune-up-reminder"))!.status).toBe("sent");

    const jamie = await apiAs("jamie");
    expect(await (await replay(jamie, cancel)).text()).toContain(NOT_ALLOWED);
    expect([307, 401, 403]).toContain((await replay(await apiAs(null), cancel, cancel.body, { maxRedirects: 0 })).status());

    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    const duplicate = await captureAction(page, () => page.getByRole("button", { name: "Duplicate campaign" }).click());
    await expect(page).toHaveURL("/marketing/cmp-cooling-tune-up-reminder-copy");
    expect(await (await replay(api, duplicate, withFirstArgument(duplicate, (args) => (args.id = "cmp-furnace-tune-up-season-notice")))).text()).toContain("That campaign no longer exists");
    expect(await (await replay(jamie, duplicate)).text()).toContain(NOT_ALLOWED);
    expect([307, 401, 403]).toContain((await replay(await apiAs(null), duplicate, duplicate.body, { maxRedirects: 0 })).status());
  });

  test("the recipients of a campaign are read only for the person's own business: another business's campaign, a stranger and no session get nothing", async ({ page, apiAs }) => {
    await page.goto("/marketing/cmp-fall-maintenance-reminder");
    const read = await captureAction(page, () => page.getByRole("button", { name: "View recipients" }).click());
    await expect(page.getByRole("dialog", { name: "Recipients" })).toBeVisible();
    const api = page.context().request;
    const gone = await (await replay(api, read, withFirstArgument(read, (args) => (args.id = "cmp-radiant-heat-estimate-offer")))).text();
    expect(gone).toContain("That campaign no longer exists");
    expect(gone).not.toContain("Priya");
    expect(gone).not.toContain("303");
    // Taylor (Northstar's owner) asking for an Apex campaign's recipients gets nothing either, and asking for his own gets his own only.
    const taylor = await apiAs("taylor");
    const denied = await (await replay(taylor, read, withFirstArgument(read, (args) => (args.id = "cmp-cooling-tune-up-reminder")))).text();
    expect(denied).toContain("That campaign no longer exists");
    expect(denied).not.toContain("Sarah Mitchell");
    expect(denied).not.toContain("(512)");
    const own = await (await replay(taylor, read, withFirstArgument(read, (args) => (args.id = "cmp-radiant-heat-estimate-offer")))).text();
    expect(own).toContain("Priya Raman");
    expect(own).not.toContain("Sarah Mitchell");
    expect([307, 401, 403]).toContain((await replay(await apiAs(null), read, read.body, { maxRedirects: 0 })).status());
  });
});

test.describe("one business's campaigns are never another's", () => {
  test("Northstar sees its own two campaigns and recipients, none of Apex's, with audiences counted from its own customers", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/marketing");
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*2$/, /^Drafts\s*1$/, /^Scheduled\s*0$/, /^Sent\s*1$/]);
    await expect(totals(page).locator("div", { hasText: /^Recent recipients/ }).first()).toContainText("0");
    await expect(row(page, "Furnace tune-up season notice")).toContainText("Draft");
    await expect(row(page, "Radiant heat estimate offer")).toContainText("SMS");
    const text = await main(page).innerText();
    for (const apexOnly of ["Fall maintenance reminder", "Cooling tune-up reminder", "Winter heating prep notice", "Filter replacement reminder", "Heat pump efficiency tips"]) expect(text, apexOnly).not.toContain(apexOnly);

    await page.goto("/marketing/cmp-fall-maintenance-reminder");
    await expect(page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
    await page.goto("/marketing/cmp-cooling-tune-up-reminder/edit");
    await expect(page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();

    await page.goto("/marketing/cmp-radiant-heat-estimate-offer");
    // Northstar's own date style: ISO.
    await expect(main(page)).toContainText("2024-10-28");
    await page.getByRole("button", { name: "View recipients" }).click();
    const dialog = page.getByRole("dialog", { name: "Recipients" });
    await expect(dialog).toContainText("Priya Raman");
    await expect(dialog).toContainText("(303) 555-0172");
    await expect(dialog).not.toContainText("Sarah");

    await page.goto("/marketing/new");
    await expect(page.getByRole("radio", { name: /^All customers/ })).toBeVisible();
    await expect(page.getByText("2 customers", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Maintenance customers/ })).toBeVisible();
    // Northstar's own business name in the starter message, never Apex's.
    await expect(page.getByLabel(/^Message content/)).toHaveValue(/Northstar Heating & Cooling/);
    await expect(page.getByLabel(/^Message content/)).not.toHaveValue(/Apex/);
  });

  test("an admin of both businesses sees each one's campaigns as the active business changes, and a reload keeps what was chosen", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/marketing");
    const name = await page.getByTitle("Switch workspace").innerText();
    const apexFirst = name.includes("Apex");
    // Whichever is active first, the other one's campaigns are not on the page.
    if (apexFirst) await expect(rows(page)).toHaveCount(11);
    else await expect(rows(page)).toHaveCount(2);
    await page.getByTitle("Switch workspace").click();
    await page.getByRole("region", { name: "Workspaces" }).getByRole("button", { name: apexFirst ? /Northstar/ : /Apex/ }).click();
    await expect(page.getByTitle("Switch workspace")).toContainText(apexFirst ? "Northstar" : "Apex");
    await hydrated(page);
    await page.goto("/marketing");
    if (apexFirst) {
      await expect(rows(page)).toHaveCount(2);
      await expect(page.getByText("Fall maintenance reminder")).toHaveCount(0);
    } else {
      await expect(rows(page)).toHaveCount(11);
      await expect(page.getByText("Furnace tune-up season notice")).toHaveCount(0);
    }
  });
});

test.describe("people who may only look", () => {
  test("a member sees the campaigns and their results, with nothing to create, change, cancel or copy", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/marketing");
    await expect(tabCounts(page)).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
    await expect(page.getByRole("link", { name: "Create campaign" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Edit campaign/ })).toHaveCount(0);
    await expect(row(page, "Seasonal service reminder").getByRole("link", { name: /View campaign/ })).toBeVisible();

    await page.goto("/marketing/cmp-fall-maintenance-reminder");
    await expect(main(page)).toContainText("Oct 30, 2024 · 9:00 AM");
    await expect(page.getByRole("button", { name: "Cancel scheduled send" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit campaign" })).toHaveCount(0);
    await expect(main(page)).toContainText("Only an owner or admin can change it.");
    // Reading who it is for is allowed to every member.
    await page.getByRole("button", { name: "View recipients" }).click();
    await expect(page.getByRole("dialog", { name: "Recipients" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    await expect(page.getByRole("button", { name: "Duplicate campaign" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Delivery records" })).toBeVisible();

    await page.goto("/marketing/new");
    await expect(page.getByRole("heading", { name: "Only an owner or admin can change campaigns" })).toBeVisible();
    await page.goto("/marketing/cmp-seasonal-service-reminder/edit");
    await expect(page.getByRole("heading", { name: "Only an owner or admin can change campaigns" })).toBeVisible();
  });
});

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("starts with real, empty Marketing: no campaigns, zero totals, audiences of zero customers, and nothing of anyone else's", async ({ page, db }) => {
    {
      await signUp(page);
      await completeOnboarding(page, { name: "Fresh Air Heating" });
      await page.goto("/marketing");
      await expect(page.getByRole("heading", { level: 1, name: "Marketing" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No campaigns yet" })).toBeVisible();
      await expect(page.getByText(/isn't available yet/)).toHaveCount(0);
      await expect(tabCounts(page)).toHaveText([/^All campaigns\s*0$/, /^Drafts\s*0$/, /^Scheduled\s*0$/, /^Sent\s*0$/]);
      // No campaign to count, so no totals: the tabs above still say 0.
      await expect(totals(page)).toHaveCount(0);
      await expect(page.getByText("Fall maintenance reminder")).toHaveCount(0);
      await page.goto("/marketing/cmp-fall-maintenance-reminder");
      await expect(page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();

      // The builder counts the business's own customers: none.
      await page.goto("/marketing/new");
      await expect(page.getByText("0 customers", { exact: true }).first()).toBeVisible();
      await expect(page.getByLabel(/^Message content/)).toHaveValue(/Fresh Air Heating/);
      await expect(page.getByLabel(/^Message content/)).not.toHaveValue(/Apex/);
      await page.getByLabel(/^Campaign name/).fill("First campaign");
      await page.getByRole("button", { name: /^Continue to review/ }).click();
      await expect(page.getByText("No customers match this audience yet.").first()).toBeVisible();
      // A draft can still be saved: it needs a name and nothing else.
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page).toHaveURL("/marketing/cmp-first-campaign");
      await page.goto("/marketing");
      await expect(tabCounts(page)).toHaveText([/^All campaigns\s*1$/, /^Drafts\s*1$/, /^Scheduled\s*0$/, /^Sent\s*0$/]);
      const organization = (await db.query("select id from organizations where name = 'Fresh Air Heating' order by created_at desc limit 1")).rows[0].id as string;
      expect((await db.query("select count(*)::int as n from marketing_campaigns where organization_id = $1", [organization])).rows[0].n).toBe(1);
      expect((await db.query("select count(*)::int as n from analytics_imported_baselines where organization_id = $1", [organization])).rows[0].n).toBe(0);
    }
  });
});
