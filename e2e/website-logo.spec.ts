/**
 * Phase 18A: the business's logo on what customers see. It is the business's Branding, read when a page is drawn (not part of a Site Version and
 * not part of a Template), so for every Template it appears when there is one and is replaced by the initials or the wordmark when there is
 * not; changing it needs no Publish and does not touch the Draft or the Published version; choosing another Template does not reset it, and
 * changing it does not change the Template. The Builder's canvas, the preview and the Marketplace listing draw the same one.
 *
 * Run on the worker's own copy of Apex, which starts with the sample logo (restored before every test). The visitor's page is looked at in a
 * real browser with no session, so "it shows" means the picture really loaded.
 */
import type { Browser, Page } from "playwright/test";
import { TEMPLATE_KEYS } from "../src/db/site-templates";
import { adminDb } from "../scripts/db/lib";
import { addReadyLogo, ORIGIN, setLogo } from "./assets-helpers";
import { expect, test } from "./saas";
import { stored, useTemplate, type Tenant } from "./website-templates-ui";

let pool: ReturnType<typeof adminDb>["pool"];
test.beforeAll(() => {
  pool = adminDb().pool;
});
test.afterAll(async () => {
  await pool.end();
});

/** A visitor's browser: no session at all. */
async function visitorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: ORIGIN, storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

const markLoaded = (page: Page, selector: string) =>
  expect.poll(() => page.locator(selector).first().evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);

const logoOf = async (organizationId: string) => (await pool.query<{ id: string | null }>("select logo_asset_id as id from organization_branding where organization_id = $1", [organizationId])).rows[0].id;
const publishedNumber = async (organizationId: string) =>
  (await pool.query<{ n: number }>("select max(v.version_number)::int as n from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'published'", [organizationId])).rows[0].n;
const templateOf = async (organizationId: string) =>
  (await pool.query<{ key: string | null }>("select t.key from sites s left join site_templates t on t.id = s.selected_template_id where s.organization_id = $1 and s.slug = 'main'", [organizationId])).rows[0].key;

const header = (page: Page) => page.locator("header").first();
const siteLogo = (page: Page) => page.locator("img[data-site-logo]");

test.describe("each Template draws the business's logo, and the business's initials or name when there is none", () => {
  for (const key of TEMPLATE_KEYS) {
    test(`${key}: with a logo, without one, with a new one (no Publish), and after choosing another Template`, async ({ browser, db, workerTenant }) => {
      const tenant: Tenant = workerTenant;
      await useTemplate(db, tenant, key, { publish: true });
      const visitor = await visitorPage(browser);
      const logo = (await logoOf(tenant.organizationId))!;

      // 1. With a logo: it is in the header, it is the business's, it is an address on this site, and the picture loads.
      await visitor.goto(`/sites/${tenant.platformSlug}`);
      await expect(siteLogo(visitor)).toHaveCount(1);
      await expect(siteLogo(visitor)).toHaveAttribute("src", `/assets/${logo}`);
      await expect(header(visitor).locator("img[data-site-logo]")).toHaveCount(1);
      await markLoaded(visitor, "img[data-site-logo]");
      await expect(header(visitor)).toContainText("Apex Climate Heating & Air");
      // Nothing of where the file is kept is in the page the visitor is given.
      const html = await visitor.content();
      expect(html).not.toMatch(/organizations\/[0-9a-f-]{36}\/assets|\.data\/|assets-test|storage_key|storageKey/);

      // 2. Without one: the business's initials (or its wordmark), its name still bound to the business, and no picture.
      await setLogo(pool, tenant.organizationId, null);
      await visitor.reload();
      await expect(siteLogo(visitor)).toHaveCount(0);
      await expect(header(visitor)).toContainText("Apex Climate Heating & Air");
      if (key !== "airflow") await expect(header(visitor).getByText("AC", { exact: true })).toHaveCount(1);

      // 3. A new logo shows with no Publish: the Draft, the Published version and the Template are as they were.
      const draftBefore = await stored(db, tenant.organizationId, "draft");
      const liveBefore = await stored(db, tenant.organizationId, "live");
      const numberBefore = await publishedNumber(tenant.organizationId);
      const templateBefore = await templateOf(tenant.organizationId);
      const replacement = await addReadyLogo(pool, tenant.organizationId, { filename: "replacement.png", color: { r: 180, g: 40, b: 40 } });
      await setLogo(pool, tenant.organizationId, replacement);
      await visitor.reload();
      await expect(siteLogo(visitor)).toHaveAttribute("src", `/assets/${replacement}`);
      await markLoaded(visitor, "img[data-site-logo]");
      expect(await stored(db, tenant.organizationId, "draft")).toEqual(draftBefore);
      expect(await stored(db, tenant.organizationId, "live")).toEqual(liveBefore);
      expect(await publishedNumber(tenant.organizationId)).toBe(numberBefore);
      expect(await templateOf(tenant.organizationId)).toBe(templateBefore);
      expect(draftBefore.templateKey).toBe(key);

      // 4. Choosing another Template does not reset the logo, and the new Template draws it.
      const next = TEMPLATE_KEYS[(TEMPLATE_KEYS.indexOf(key) + 1) % TEMPLATE_KEYS.length];
      await useTemplate(db, tenant, next, { publish: true });
      expect(await logoOf(tenant.organizationId)).toBe(replacement);
      await visitor.goto(`/sites/${tenant.platformSlug}`);
      await expect(siteLogo(visitor)).toHaveAttribute("src", `/assets/${replacement}`);
      await visitor.context().close();
    });
  }
});

test.describe("the other places that draw it", () => {
  test("the Builder's canvas and the signed-in preview draw the current logo, and the initials when there is none", async ({ page, workerTenant }) => {
    await page.goto("/website/builder");
    const canvas = page.locator("[data-site-theme]").first();
    const logo = (await logoOf(workerTenant.organizationId))!;
    await expect(canvas.locator("img[data-site-logo]")).toHaveAttribute("src", `/assets/${logo}`);
    await markLoaded(page, "[data-site-theme] img[data-site-logo]");
    // The canvas is a picture of the finished page: the logo in it is not a link or a control.
    await expect(canvas.locator("img[data-site-logo]")).not.toHaveAttribute("tabindex", /.*/);

    await page.goto("/website/preview");
    await expect(page.getByTestId("site-frame").locator("img[data-site-logo]")).toHaveAttribute("src", `/assets/${logo}`);

    await setLogo(pool, workerTenant.organizationId, null);
    await page.goto("/website/builder");
    await expect(page.locator("[data-site-theme] img[data-site-logo]")).toHaveCount(0);
    await expect(page.locator("[data-site-theme]").first().locator("header")).toContainText("AC");
    await page.goto("/website/preview");
    await expect(page.getByTestId("site-frame").locator("img[data-site-logo]")).toHaveCount(0);
  });

  test("the Marketplace listing draws the same logo, for a visitor and in the workspace's preview", async ({ browser, page, workerTenant }) => {
    const logo = (await logoOf(workerTenant.organizationId))!;
    const visitor = await visitorPage(browser);
    await visitor.goto(`/listings/${workerTenant.listingSlug}`);
    await expect(visitor.getByRole("article").locator("img[data-site-logo]")).toHaveAttribute("src", `/assets/${logo}`);
    await markLoaded(visitor, "article img[data-site-logo]");
    await page.goto("/marketplace/preview");
    await expect(page.getByRole("article").locator("img[data-site-logo]")).toHaveAttribute("src", `/assets/${logo}`);

    await setLogo(pool, workerTenant.organizationId, null);
    await visitor.reload();
    await expect(visitor.getByRole("article").locator("img[data-site-logo]")).toHaveCount(0);
    await expect(visitor.getByRole("article")).toContainText("AC");
    await visitor.context().close();
  });

  test("the Template Gallery draws a made-up business, never the real one's logo", async ({ page }) => {
    await page.goto("/website/templates");
    await expect(page.getByRole("heading", { level: 1, name: "Website templates" })).toBeVisible();
    await expect(page.locator("[data-template]")).toHaveCount(4);
    await expect(page.locator("img[data-site-logo]")).toHaveCount(0);
  });

  test("a business that has set no logo shows no picture on its public Site, and its Site is otherwise whole", async ({ browser }) => {
    const visitor = await visitorPage(browser);
    await visitor.goto("/sites/northstar");
    await expect(siteLogo(visitor)).toHaveCount(0);
    await expect(header(visitor)).toContainText("Northstar Heating & Cooling");
    await visitor.context().close();
  });
});
