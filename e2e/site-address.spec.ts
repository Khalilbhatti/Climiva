/**
 * Phase 19D, a Site's address on the screens, in a browser: written from the deployment's configured origin as `<origin>/sites/<slug>` (never
 * `<slug>.<a domain the product owns>`), the same on every screen that shows it, and an address that really opens the Site. A customer's own domain,
 * once active and main, is shown in its place, as before.
 */
import { randomBytes } from "node:crypto";
import { adminDb } from "../scripts/db/lib";
import { DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { createDraftFromTemplate, publishSite } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { insertActiveClaim, rawRequest, uniqueHost } from "./domain-helpers";
import { setHeadlineOf } from "./draft-edits";
import { siteAddress } from "./fixtures";
import { makeProvider } from "./marketplace-helpers";
import { NOT_SIGNED_IN, ORIGIN, expect, test, toast } from "./saas";

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const main = (page: import("playwright/test").Page) => page.getByRole("main");

test.describe("the business's own screens", () => {
  test("Website, Pages, Domain, Overview and the Marketplace listing all write the same address, and it opens the Site", async ({ page, workerTenant }) => {
    const address = siteAddress(workerTenant.platformSlug);
    expect(address).toBe(`${ORIGIN}/sites/${workerTenant.platformSlug}`);

    for (const path of ["/website", "/website/pages", "/website/domain", "/overview", "/marketplace-listing"]) {
      await page.goto(path);
      await expect(main(page), path).toContainText(address);
      expect(await main(page).innerText(), path).not.toMatch(/\.climvia\.com/);
    }
    await page.goto("/website/domain");
    await expect(page.getByRole("button", { name: `Copy ${address}` })).toBeVisible();

    // The address is not decoration: it opens the Site, on the same origin, to a visitor with no account.
    const opened = await rawRequest(ORIGIN, new URL(address).pathname);
    expect(opened.status).toBe(200);
  });

  test("the booking link the Bookings screen copies is that address plus the Booking page, and it opens the Booking page", async ({ page, context, workerTenant }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
    await page.goto("/bookings");
    await page.getByRole("button", { name: "Copy booking link" }).click();
    const copied = (await toast(page).innerText()).match(/https?:\/\/\S+|\/sites\/\S+/)?.[0] ?? (await page.evaluate(() => navigator.clipboard.readText()));
    expect(copied).toBe(`${siteAddress(workerTenant.platformSlug)}/booking`);
    expect((await rawRequest(ORIGIN, new URL(copied).pathname)).status).toBe(200);
  });

  test("once a customer's own domain is active and main it is the address shown, and the platform address is still there, never replaced", async ({ page, workerTenant }) => {
    const host = uniqueHost("addr");
    await insertActiveClaim(owner.pool, workerTenant.organizationId, host);
    await page.goto("/website/domain");
    await expect(page.getByText("Current primary address:")).toContainText(`http://${host}`);
    await expect(page.getByRole("region", { name: "Website address" })).toContainText(siteAddress(workerTenant.platformSlug));
  });
});

test.describe("the public Marketplace profile", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a provider's website is written as the address on the platform and linked as a path on this host; the booking link and the invitation to businesses stay separate", async ({ page }) => {
    const provider = await makeProvider("siteaddr", { db: owner.db, pool: owner.pool });
    const site = await owner.pool.query<{ id: string; platform_slug: string }>("select id, platform_slug from sites where organization_id = $1 and slug = 'main'", [provider.business.organizationId]);
    const who = { userId: provider.business.owner.userId, organizationId: provider.business.organizationId };
    await withTenant(who, async (tx) => {
      const ctx = { tx, organizationId: who.organizationId };
      await createDraftFromTemplate(ctx, site.rows[0].id, DEFAULT_TEMPLATE_KEY);
      await setHeadlineOf(ctx, site.rows[0].id, `Address headline ${randomBytes(3).toString("hex")}`);
      await publishSite(ctx, site.rows[0].id, who.userId);
    });

    await page.goto(`/listings/${provider.slug}`);
    const text = await main(page).innerText();
    expect(text).toContain(siteAddress(site.rows[0].platform_slug));
    expect(text).not.toMatch(/\.climvia\.com/);
    await expect(main(page).getByRole("link", { name: /View website/ }).first()).toHaveAttribute("href", `/sites/${site.rows[0].platform_slug}`);
    await expect(main(page).locator(`a[href^="/listings/${provider.slug}/book/"]`).first()).toBeVisible();
  });
});
