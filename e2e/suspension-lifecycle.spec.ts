/**
 * Phase 19C, a suspension as the people involved live it: the platform suspends a listing and tells the business what it chooses to; the business reads
 * that (and never the internal reason), asks for a second look, and sees the answer; the platform sees the request first and keeps the suspension or lifts
 * it; every public surface follows; and every step is on the audit trail.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { anonymous, signedIn } from "./assets-helpers";
import { makeProvider, type Provider } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { expect, expectAccessible, test } from "./saas";

test.describe.configure({ timeout: 180_000 });

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const INTERNAL = "INTERNAL: complaint 7731, see ops notes";
const MESSAGE = "Your listing names services you do not offer. Remove them and ask us to look again.";

async function openAs(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const where = address();
  const state = await (await signedIn(email, where)).storageState();
  const context = await browser.newContext({ storageState: state, viewport, extraHTTPHeaders: { "x-forwarded-for": where } });
  return { context, page: await context.newPage() };
}

/** What a visitor can reach of a provider: its profile, its search card, its booking page and its place in the sitemap. */
async function reach(provider: Provider) {
  const api = await anonymous(address());
  const profile = (await api.get(`/listings/${provider.slug}`, { maxRedirects: 0 })).status();
  const search = await (await api.get(`/marketplace?q=${provider.token}`)).text();
  const booking = (await api.get(`/listings/${provider.slug}/book/ac-repair-diagnostics`, { maxRedirects: 0 })).status();
  const sitemap = await (await api.get("/sitemap.xml")).text();
  await api.dispose();
  return { profile, found: search.includes(provider.name), booking, inSitemap: sitemap.includes(`/listings/${provider.slug}`) };
}

const row = (page: Page, provider: Provider) => page.getByRole("row").filter({ hasText: provider.name });
const notice = (page: Page) => page.getByRole("status").filter({ hasText: "Climvia has suspended your Marketplace listing" });

test.describe("a suspension, start to finish", () => {
  test("the platform suspends and tells the business; the business asks for a second look; the platform sees it first and answers; every surface follows", async ({ browser }) => {
    const provider = await makeProvider("suslife", { db: owner.db, pool: owner.pool }, { areas: [{ city: "Austin", state: "TX" }] });
    const admin = await makePlatformAdmin("suslifeadm", owner.db, owner.pool);
    expect(await reach(provider)).toEqual({ profile: 200, found: true, booking: 200, inSitemap: true });
    const console = await openAs(browser, admin.email);

    // 1. The platform suspends it, with an internal reason and a message for the business.
    await console.page.goto(`/platform-admin/marketplace?q=${provider.token}`);
    await row(console.page, provider).getByText("Suspend…").click();
    await row(console.page, provider).getByLabel("Internal reason (optional)").fill(INTERNAL);
    await row(console.page, provider).getByLabel("Message to the business (optional)").fill(MESSAGE);
    await row(console.page, provider).getByRole("button", { name: "Suspend listing" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The listing is suspended." })).toBeVisible();
    await expect(row(console.page, provider)).toContainText("Suspended");
    await expect(row(console.page, provider)).toContainText(`Internal reason: ${INTERNAL}`);
    await expect(row(console.page, provider)).toContainText(`Message to the business: ${MESSAGE}`);
    // Visitors lose it everywhere, at once.
    expect(await reach(provider)).toEqual({ profile: 404, found: false, booking: 404, inSitemap: false });

    // 2. The business is told: what Climvia chose to say, when it began, and nothing internal.
    const business = await openAs(browser, provider.business.owner.email);
    await business.page.goto("/marketplace-listing");
    await expect(notice(business.page)).toBeVisible();
    await expect(notice(business.page)).toContainText("Message from Climvia");
    await expect(notice(business.page)).toContainText(MESSAGE);
    await expect(notice(business.page)).toContainText(/Suspended on [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    const html = await business.page.content();
    for (const secret of [INTERNAL, "complaint 7731", "ops notes", admin.email, admin.userId]) expect(html, secret).not.toContain(secret);
    await expect(business.page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
    await expect(business.page.getByText("Suspended by Climvia", { exact: true })).toBeVisible();
    await expectAccessible(business.page);

    // A member of the business can read it but is not offered the request.
    const member = await openAs(browser, provider.business.member.email);
    await member.page.goto("/marketplace-listing");
    await expect(notice(member.page)).toContainText(MESSAGE);
    await expect(notice(member.page)).toContainText("An owner or admin of your workspace can ask Climvia to review this suspension.");
    await expect(member.page.getByRole("button", { name: "Ask Climvia to review" })).toHaveCount(0);

    // 3. The owner asks for a second look. Nothing about visibility changes, and the form gives way to the status.
    await business.page.getByLabel(/Ask Climvia to review this suspension/).fill("We removed the two services we do not offer.");
    await business.page.getByRole("button", { name: "Ask Climvia to review" }).click();
    await expect(notice(business.page)).toContainText("You asked Climvia to review this suspension");
    await expect(notice(business.page)).toContainText("Your note: We removed the two services we do not offer.");
    await expect(business.page.getByRole("button", { name: "Ask Climvia to review" })).toHaveCount(0);
    await business.page.reload();
    await expect(notice(business.page)).toContainText("You asked Climvia to review this suspension");
    expect(await reach(provider)).toEqual({ profile: 404, found: false, booking: 404, inSitemap: false });

    // 4. The platform sees it first: a banner, the Overview count, the listing at the top with the business's words, and the question and the answer in one place.
    await console.page.goto("/platform-admin");
    await expect(console.page.getByRole("link", { name: /Review requests waiting/ })).toBeVisible();
    await console.page.goto(`/platform-admin/marketplace?q=${provider.token}`);
    await expect(console.page.getByText(/asked for a suspension to be looked at again/)).toBeVisible();
    await expect(row(console.page, provider)).toContainText("Review requested");
    await expect(row(console.page, provider).getByRole("group", { name: `Review request from ${provider.name}` })).toContainText("Their note: We removed the two services we do not offer.");
    await expectAccessible(console.page);

    // 5. The platform keeps the suspension and says why; the business reads it, and cannot ask again for a day.
    const keep = row(console.page, provider).locator("details", { hasText: "Keep suspended…" });
    await keep.getByText("Keep suspended…").click();
    await keep.getByLabel("Message to the business (optional)").fill("We looked again; the description still lists a furnace service.");
    await keep.getByRole("button", { name: "Keep suspended" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The suspension stays." })).toBeVisible();
    await business.page.reload();
    await expect(notice(business.page)).toContainText("Climvia reviewed your request and the suspension stays");
    await expect(notice(business.page)).toContainText("We looked again; the description still lists a furnace service.");
    await business.page.getByRole("button", { name: "Ask Climvia to review" }).click();
    await expect(business.page.getByRole("alert").filter({ hasText: /You can ask again in about \d+ hours?\./ })).toBeVisible();
    expect(await reach(provider)).toEqual({ profile: 404, found: false, booking: 404, inSitemap: false });

    // 6. Later the business may ask again (the day has passed); the platform lifts the suspension, and everything returns.
    await owner.pool.query("update platform_listing_moderation set review_resolved_at = now() - interval '25 hours' where listing_id = $1", [provider.listingId]);
    await business.page.reload();
    await business.page.getByLabel(/Ask Climvia to review this suspension/).fill("Fixed the furnace line too.");
    await business.page.getByRole("button", { name: "Ask Climvia to review" }).click();
    await expect(notice(business.page)).toContainText("You asked Climvia to review this suspension");
    await console.page.goto(`/platform-admin/marketplace?q=${provider.token}`);
    await row(console.page, provider).getByRole("button", { name: "Allow again" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The listing is allowed again." })).toBeVisible();
    expect(await reach(provider)).toEqual({ profile: 200, found: true, booking: 200, inSitemap: true });
    await business.page.reload();
    await expect(notice(business.page)).toHaveCount(0);
    await expect(business.page.getByText("Suspended by Climvia", { exact: true })).toHaveCount(0);
    await member.page.reload();
    await expect(notice(member.page)).toHaveCount(0);

    // 7. All of it is on the trail, in order, by the right kind of actor, and the trail shows the business's own request as the business's.
    const trail = (await owner.pool.query("select action, actor_kind, reason from platform_audit_events where target_id = $1 order by occurred_at, id", [provider.listingId])).rows;
    expect(trail.map((entry) => entry.action)).toEqual([
      "marketplace_listing.suspended",
      "marketplace_listing.review_requested",
      "marketplace_listing.review_resolved",
      "marketplace_listing.review_requested",
      "marketplace_listing.unsuspended",
      "marketplace_listing.review_resolved",
    ]);
    expect(trail.map((entry) => entry.actor_kind)).toEqual(["platform_admin", "organization_member", "platform_admin", "organization_member", "platform_admin", "platform_admin"]);
    expect(trail[0].reason).toBe(INTERNAL);
    await console.page.goto("/platform-admin/system");
    const activity = await console.page.getByRole("table", { name: "Recent platform activity" }).innerText();
    for (const label of ["Listing suspended", "Business asked for a suspension to be reviewed", "Suspension review answered", "Listing allowed again"]) expect(activity, label).toContain(label);
    await business.context.close();
    await member.context.close();
    await console.context.close();
  });

  test("changing only the message tells the business the new words and keeps the internal reason where it was", async ({ browser }) => {
    const provider = await makeProvider("susmsg", { db: owner.db, pool: owner.pool });
    const admin = await makePlatformAdmin("susmsgadm", owner.db, owner.pool);
    const console = await openAs(browser, admin.email);
    await console.page.goto(`/platform-admin/marketplace?q=${provider.token}`);
    await row(console.page, provider).getByText("Suspend…").click();
    await row(console.page, provider).getByLabel("Internal reason (optional)").fill("internal one");
    await row(console.page, provider).getByRole("button", { name: "Suspend listing" }).click();
    await expect(row(console.page, provider)).toContainText("Message to the business: None.");
    const edit = row(console.page, provider).locator("details", { hasText: "Edit message…" });
    await edit.getByText("Edit message…").click();
    await edit.getByLabel("Message to the business (optional)").fill("Please update your description.");
    await edit.getByRole("button", { name: "Save message" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The message to the business was updated." })).toBeVisible();
    await expect(row(console.page, provider)).toContainText("Internal reason: internal one");
    const business = await openAs(browser, provider.business.admin.email);
    await business.page.goto("/marketplace-listing");
    await expect(notice(business.page)).toContainText("Please update your description.");
    expect(await business.page.content()).not.toContain("internal one");
    await business.context.close();
    await console.context.close();
  });

  test("a business that hid its own listing before the suspension stays hidden when the platform lets it back", async ({ browser }) => {
    const provider = await makeProvider("suspriv", { db: owner.db, pool: owner.pool }, { status: "hidden" });
    const admin = await makePlatformAdmin("suspriv", owner.db, owner.pool);
    const console = await openAs(browser, admin.email);
    await console.page.goto(`/platform-admin/marketplace?q=${provider.token}`);
    await row(console.page, provider).getByText("Suspend…").click();
    await row(console.page, provider).getByRole("button", { name: "Suspend listing" }).click();
    await expect(row(console.page, provider)).toContainText("Suspended");
    await row(console.page, provider).getByRole("button", { name: "Allow again" }).click();
    await expect(console.page.getByRole("status").filter({ hasText: "The listing is allowed again." })).toBeVisible();
    await expect(row(console.page, provider)).toContainText("Not available");
    expect(await reach(provider)).toEqual({ profile: 404, found: false, booking: 404, inSitemap: false });
    await console.context.close();
  });

  test("a business cannot lift its own suspension or answer its own request: nothing it can send changes the decision", async ({ browser }) => {
    const provider = await makeProvider("susforge", { db: owner.db, pool: owner.pool });
    const admin = await makePlatformAdmin("susforgeadm", owner.db, owner.pool);
    await owner.pool.query("insert into platform_listing_moderation (listing_id, state, reason, tenant_message, suspended_at, decided_by) values ($1, 'suspended', 'internal', 'm', now(), $2)", [provider.listingId, admin.userId]);
    const business = await openAs(browser, provider.business.owner.email);
    // Publishing again, saving the listing and the console's own address change nothing and do not reach the decision.
    await business.page.goto("/marketplace-listing");
    await expect(notice(business.page)).toBeVisible();
    expect((await business.page.request.get("/platform-admin/marketplace", { maxRedirects: 0 })).status()).toBe(404);
    expect(await reach(provider)).toEqual({ profile: 404, found: false, booking: 404, inSitemap: false });
    const row = (await owner.pool.query("select state, review_state from platform_listing_moderation where listing_id = $1", [provider.listingId])).rows[0];
    expect(row).toEqual({ state: "suspended", review_state: "none" });
    // Even with its own request recorded, only the platform's answer changes the state.
    await business.page.getByRole("button", { name: "Ask Climvia to review" }).click();
    await expect(notice(business.page)).toContainText("You asked Climvia to review this suspension");
    expect((await owner.pool.query("select state, review_state from platform_listing_moderation where listing_id = $1", [provider.listingId])).rows[0]).toEqual({ state: "suspended", review_state: "requested" });
    expect(await reach(provider)).toEqual({ profile: 404, found: false, booking: 404, inSitemap: false });
    await business.context.close();
  });

  test("on a tablet (the smallest size the workspace is laid out for) the business's notice and its request form fit the screen", async ({ browser }) => {
    const provider = await makeProvider("susphone", { db: owner.db, pool: owner.pool });
    const admin = await makePlatformAdmin("susphoneadm", owner.db, owner.pool);
    await owner.pool.query("insert into platform_listing_moderation (listing_id, state, reason, tenant_message, suspended_at, decided_by) values ($1, 'suspended', 'internal', $2, now(), $3)", [provider.listingId, MESSAGE, admin.userId]);
    // The workspace keeps its sidebar at every width and is audited from 768 px (responsive.spec.ts), so a phone is not a size it is laid out for: a 390 px page
    // is mostly sidebar. The tablet is the smallest real size, and the notice and its form must fit it.
    const business = await openAs(browser, provider.business.owner.email, { width: 768, height: 1024 });
    await business.page.goto("/marketplace-listing");
    await expect(notice(business.page)).toBeVisible();
    expect(await business.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const box = await notice(business.page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 768).toBe(true);
    for (const control of [business.page.getByLabel(/Ask Climvia to review this suspension/), business.page.getByRole("button", { name: "Ask Climvia to review" })]) {
      const part = await control.boundingBox();
      expect(part?.x, "left edge").toBeGreaterThanOrEqual(0);
      expect((part?.x ?? 0) + (part?.width ?? 0), "right edge").toBeLessThanOrEqual(768);
    }
    await business.page.getByRole("button", { name: "Ask Climvia to review" }).scrollIntoViewIfNeeded();
    await expect(business.page.getByRole("button", { name: "Ask Climvia to review" })).toBeInViewport();
    await expectAccessible(business.page);
    await business.context.close();
  });
});
