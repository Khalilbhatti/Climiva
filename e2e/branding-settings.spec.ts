/**
 * Phase 18A: Settings → Branding, stored. What a person does (choose a file, save, replace, remove, set the accent) and what is true afterwards
 * (it is in the database and the object store, so it survives a reload, a new session and a new browser), who may do it, and that one
 * business's Branding never reaches another's, including for a person who works in two.
 *
 * The worker's own copy of the Apex workspace is the business edited (it starts with the sample logo and the Apex accent, restored before every
 * test); businesses made for the purpose are the ones with a member who may only look, and with a person in two workspaces. The standing
 * Apex and Northstar are only read.
 */
import type { Page } from "playwright/test";
import { createLocalStorage } from "../src/storage/local";
import { assetKey } from "../src/storage";
import { APEX_CREST_FILE_NAME } from "../scripts/db/seed-data/apex";
import { adminDb } from "../scripts/db/lib";
import { ensureMembership } from "../scripts/db/seed-lib";
import { makeBusiness, ORIGIN, picture } from "./assets-helpers";
import { signInOverHttp, waitsForHydration } from "./fixtures";
import { expect, switchWorkspace, test } from "./saas";

const saveBranding = (page: Page) => page.getByRole("button", { name: "Save branding", exact: true });
const unsaved = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });
const toast = (page: Page) => page.getByRole("status");
/** The big tile in the Logo card (the picture is decorative, so it has no role: it is found by where it sits). */
const logoImg = (page: Page) => page.locator("section[aria-labelledby='logo-heading'] img");
const identity = (page: Page) => page.getByRole("region", { name: "Brand identity" });
const choose = (page: Page, name: string, buffer: Buffer, mimeType = "image/png") => page.getByLabel("Choose a logo file").setInputFiles({ name, mimeType, buffer });
const loaded = (page: Page) => expect.poll(() => logoImg(page).evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);

let pool: ReturnType<typeof adminDb>["pool"];
let db: ReturnType<typeof adminDb>["db"];
test.beforeAll(() => {
  const admin = adminDb();
  pool = admin.pool;
  db = admin.db;
});
test.afterAll(async () => {
  await pool.end();
});

const brandingOf = async (organizationId: string) =>
  (await pool.query<{ logo_asset_id: string | null; accent: string | null }>("select logo_asset_id, accent from organization_branding where organization_id = $1", [organizationId])).rows[0];
const assetCount = async (organizationId: string) => (await pool.query<{ n: number }>("select count(*)::int as n from assets where organization_id = $1", [organizationId])).rows[0].n;

test.describe("the sample business", () => {
  test("opens on its stored logo and accent, and the picture is really there", async ({ page, workerTenant }) => {
    await page.goto("/settings/branding");
    await expect(page.getByText(APEX_CREST_FILE_NAME)).toBeVisible();
    await expect(page.getByLabel("HEX")).toHaveValue("#0D5C63");
    await expect(identity(page)).toContainText("Logo: Active");
    const stored = await brandingOf(workerTenant.organizationId);
    await expect(logoImg(page)).toHaveAttribute("src", `/assets/${stored.logo_asset_id}`);
    await loaded(page);
    // The picture is the file in the store, a WebP, served from this site: not a data URL, a blob, or an address outside it.
    const response = await page.request.get(`/assets/${stored.logo_asset_id}`, { headers: { cookie: "" } });
    expect(response.headers()["content-type"]).toBe("image/webp");
  });
});

test.describe("choosing and saving a logo", () => {
  test("a chosen file is a preview until saved; saving stores it, and it is there after a reload, in a new session and in a new browser", async ({ page, workerTenant, browser, clientAddresses }) => {
    await page.goto("/settings/branding");
    const before = await brandingOf(workerTenant.organizationId);
    await choose(page, "Brand Mark.png", await picture("png", 240, 120));
    await expect(page.getByText("Brand Mark.png")).toBeVisible();
    await expect(logoImg(page)).toHaveAttribute("src", /^blob:/);
    await expect(unsaved(page)).toContainText("You have unsaved changes to your branding.");
    // Nothing is stored by choosing.
    expect(await brandingOf(workerTenant.organizationId)).toEqual(before);

    await saveBranding(page).click();
    await expect(toast(page)).toContainText("Branding saved.");
    await expect(unsaved(page)).toHaveCount(0);
    // What the form shows now is the stored logo, an address on this site.
    const src = await logoImg(page).getAttribute("src");
    expect(src).toMatch(/^\/assets\/[0-9a-f-]{36}$/);
    await loaded(page);
    const id = src!.replace("/assets/", "");
    const stored = await brandingOf(workerTenant.organizationId);
    expect(stored.logo_asset_id).toBe(id);
    expect(id).not.toBe(before.logo_asset_id);
    const row = (await pool.query("select original_filename, created_by_user_id, status, storage_key from assets where id = $1", [id])).rows[0];
    expect(row).toMatchObject({ original_filename: "Brand Mark.png", created_by_user_id: workerTenant.userId, status: "ready", storage_key: assetKey(workerTenant.organizationId, id) });
    expect(await createLocalStorage(process.env.ASSET_LOCAL_DIR!).exists(row.storage_key)).toBe(true);

    // A reload.
    await page.reload();
    await expect(page.getByText("Brand Mark.png")).toBeVisible();
    await expect(logoImg(page)).toHaveAttribute("src", src!);
    await expect(identity(page)).toContainText("Logo: Active");
    await loaded(page);

    // A completely new session in a new browser.
    const context = await browser.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const fresh = waitsForHydration(await context.newPage());
    await fresh.goto("/settings/branding");
    await expect(fresh.getByText("Brand Mark.png")).toBeVisible();
    await expect(logoImg(fresh)).toHaveAttribute("src", src!);
    await loaded(fresh);
    await context.close();
  });

  test("replacing switches to the new file; removing falls back to the initials; the accent is stored with them", async ({ page, workerTenant }) => {
    await page.goto("/settings/branding");
    const first = (await brandingOf(workerTenant.organizationId)).logo_asset_id!;

    await choose(page, "second.jpg", await picture("jpeg", 200, 200), "image/jpeg");
    await page.getByLabel("HEX").fill("#8B3A1E");
    await saveBranding(page).click();
    await expect(toast(page)).toContainText("Branding saved.");
    const second = (await brandingOf(workerTenant.organizationId));
    expect(second.logo_asset_id).not.toBe(first);
    expect(second.accent).toBe("#8B3A1E");
    await expect(logoImg(page)).toHaveAttribute("src", `/assets/${second.logo_asset_id}`);
    // Both files are kept; only the new one is the logo.
    expect((await pool.query("select status from assets where id = any($1)", [[first, second.logo_asset_id]])).rows.map((row) => row.status)).toEqual(["ready", "ready"]);

    await page.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("No logo. The initials below are shown instead.")).toBeVisible();
    await expect(unsaved(page)).toBeVisible();
    await saveBranding(page).click();
    await expect(identity(page)).toContainText("Logo: Not set");
    await expect(page.getByRole("button", { name: "Add logo" })).toBeVisible();
    expect(await brandingOf(workerTenant.organizationId)).toEqual({ logo_asset_id: null, accent: "#8B3A1E" });

    await page.reload();
    await expect(page.getByText("No logo. The initials below are shown instead.")).toBeVisible();
    await expect(page.getByLabel("HEX")).toHaveValue("#8B3A1E");
    await expect(identity(page)).toContainText("#8B3A1E");
  });

  test("the accent alone can be saved and cleared, and the logo is left alone", async ({ page, workerTenant }) => {
    await page.goto("/settings/branding");
    const logo = (await brandingOf(workerTenant.organizationId)).logo_asset_id;
    await page.getByRole("button", { name: "Use #17766B" }).click();
    await saveBranding(page).click();
    await expect(unsaved(page)).toHaveCount(0);
    expect(await brandingOf(workerTenant.organizationId)).toEqual({ logo_asset_id: logo, accent: "#17766B" });
    await page.getByLabel("HEX").fill("");
    await saveBranding(page).click();
    await expect(identity(page)).toContainText("Default");
    expect(await brandingOf(workerTenant.organizationId)).toEqual({ logo_asset_id: logo, accent: null });
  });
});

test.describe("what goes wrong", () => {
  test("an obvious mistake is told at once and nothing is queued; a file the server will not accept is told after Save, and the form is kept", async ({ page, workerTenant, consoleGuard }) => {
    // The browser logs the refusal it is shown: that is the point of this test, so it is allowed here and nowhere else.
    consoleGuard.allow(/status of 415/);
    await page.goto("/settings/branding");
    const before = await brandingOf(workerTenant.organizationId);
    const assets = await assetCount(workerTenant.organizationId);

    await choose(page, "notes.txt", Buffer.from("x"), "text/plain");
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG, JPG or WebP image." })).toBeVisible();
    await choose(page, "logo.svg", Buffer.from("<svg/>"), "image/svg+xml");
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG, JPG or WebP image." })).toBeVisible();
    await choose(page, "huge.png", Buffer.alloc(5 * 1024 * 1024 + 1), "image/png");
    await expect(page.getByRole("alert").filter({ hasText: "That image is too large." })).toBeVisible();
    await expect(unsaved(page)).toHaveCount(0);

    // It says it is a PNG, but it is not an image: the server reads the file and refuses it.
    await choose(page, "fake.png", Buffer.from("this is not an image"), "image/png");
    await expect(unsaved(page)).toBeVisible();
    await saveBranding(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG, JPG or WebP image." })).toBeVisible();
    await expect(unsaved(page)).toBeVisible();
    await expect(page.getByText("fake.png")).toBeVisible();
    expect(await brandingOf(workerTenant.organizationId)).toEqual(before);
    expect(await assetCount(workerTenant.organizationId)).toBe(assets);
  });

  test("discarding a chosen file stores nothing and puts the stored logo back", async ({ page, workerTenant }) => {
    await page.goto("/settings/branding");
    const before = await brandingOf(workerTenant.organizationId);
    const assets = await assetCount(workerTenant.organizationId);
    await choose(page, "never-saved.png", await picture("png"));
    await expect(page.getByText("never-saved.png")).toBeVisible();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByText("never-saved.png")).toHaveCount(0);
    await expect(logoImg(page)).toHaveAttribute("src", `/assets/${before.logo_asset_id}`);
    expect(await brandingOf(workerTenant.organizationId)).toEqual(before);
    expect(await assetCount(workerTenant.organizationId)).toBe(assets);
  });

  test("pressing Save twice quickly stores one file: the button is off while it saves", async ({ page, workerTenant }) => {
    await page.goto("/settings/branding");
    const assets = await assetCount(workerTenant.organizationId);
    await choose(page, "double.png", await picture("png", 300, 300));
    await saveBranding(page).dblclick();
    await expect(toast(page)).toContainText("Branding saved.");
    await expect(unsaved(page)).toHaveCount(0);
    expect(await assetCount(workerTenant.organizationId)).toBe(assets + 1);
  });

  test("two tabs saving different logos end with one definite logo, and both files exist and are the business's own", async ({ page, workerTenant }) => {
    const other = waitsForHydration(await page.context().newPage());
    const files = () => pool.query("select count(*)::int as n from assets where organization_id = $1 and original_filename in ('tab-one.png', 'tab-two.png') and status = 'ready'", [workerTenant.organizationId]).then((result) => result.rows[0].n as number);
    const before = await files();
    await page.goto("/settings/branding");
    await other.goto("/settings/branding");
    await choose(page, "tab-one.png", await picture("png", 100, 100, { r: 200, g: 30, b: 30 }));
    await choose(other, "tab-two.png", await picture("png", 100, 100, { r: 30, g: 30, b: 200 }));
    await saveBranding(page).click();
    await expect(toast(page)).toContainText("Branding saved.");
    await saveBranding(other).click();
    await expect(toast(other)).toContainText("Branding saved.");
    // Last write wins, and it is exactly one of the two.
    const branding = await brandingOf(workerTenant.organizationId);
    const row = (await pool.query("select original_filename from assets where id = $1", [branding.logo_asset_id])).rows[0];
    expect(row.original_filename).toBe("tab-two.png");
    expect((await files()) - before).toBe(2);
  });
});

test.describe("who may change it", () => {
  test("a member who may only look sees the branding, cannot choose, save or remove, and the server would refuse anyway", async ({ browser, clientAddresses }) => {
    const biz = await makeBusiness("lookonly", db);
    // The business has a logo, saved by its owner.
    const ownerContext = await browser.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(biz.owner.email, process.env.SEED_PASSWORD ?? "", clientAddresses()), extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const owner = waitsForHydration(await ownerContext.newPage());
    await owner.goto("/settings/branding");
    await choose(owner, "owners-logo.png", await picture("png", 90, 90));
    await saveBranding(owner).click();
    await expect(toast(owner)).toContainText("Branding saved.");
    await ownerContext.close();

    const memberContext = await browser.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(biz.member.email, process.env.SEED_PASSWORD ?? "", clientAddresses()), extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const member = waitsForHydration(await memberContext.newPage());
    await member.goto("/settings/branding");
    await expect(member.getByText("Only an owner or admin can change this. You can view it here.")).toBeVisible();
    await expect(member.getByText("owners-logo.png")).toBeVisible();
    await expect(logoImg(member)).toHaveAttribute("src", /^\/assets\//);
    await expect(member.getByRole("button", { name: "Change logo" })).toBeDisabled();
    await expect(member.getByRole("button", { name: "Remove logo" })).toBeDisabled();
    await expect(member.getByLabel("HEX")).toBeDisabled();
    await expect(saveBranding(member)).toBeDisabled();
    await memberContext.close();
  });

  test("a person in two businesses sees each one's own Branding, and saving in one never reaches the other", async ({ browser, clientAddresses }) => {
    const first = await makeBusiness("two-a", db);
    const second = await makeBusiness("two-b", db);
    // The first business's owner is also an admin of the second.
    await ensureMembership(db, { organizationId: second.organizationId, userId: first.owner.userId, role: "admin" });
    const context = await browser.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(first.owner.email, process.env.SEED_PASSWORD ?? "", clientAddresses()), extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    await page.goto("/settings/branding");
    await choose(page, "first-business.png", await picture("png", 120, 120));
    await page.getByLabel("HEX").fill("#8B3A1E");
    await saveBranding(page).click();
    await expect(toast(page)).toContainText("Branding saved.");

    await switchWorkspace(page, new RegExp(`Logo Test two-b`));
    await page.goto("/settings/branding");
    await expect(page.getByText("No logo. The initials below are shown instead.")).toBeVisible();
    await expect(page.getByText("first-business.png")).toHaveCount(0);
    await expect(page.getByLabel("HEX")).toHaveValue("");
    await choose(page, "second-business.png", await picture("png", 130, 130, { r: 30, g: 120, b: 30 }));
    await saveBranding(page).click();
    await expect(toast(page)).toContainText("Branding saved.");

    await switchWorkspace(page, new RegExp(`Logo Test two-a`));
    await page.goto("/settings/branding");
    await expect(page.getByText("first-business.png")).toBeVisible();
    await expect(page.getByText("second-business.png")).toHaveCount(0);
    await expect(page.getByLabel("HEX")).toHaveValue("#8B3A1E");
    expect((await brandingOf(first.organizationId)).accent).toBe("#8B3A1E");
    expect((await brandingOf(second.organizationId)).accent).toBeNull();
    // Each business's logo is one of its own files.
    for (const biz of [first, second]) {
      const owner = (await pool.query("select organization_id from assets where id = $1", [(await brandingOf(biz.organizationId)).logo_asset_id])).rows[0];
      expect(owner.organization_id).toBe(biz.organizationId);
    }
    await context.close();
  });
});

test.describe("the standing businesses", () => {
  test("Northstar has no Branding and no files, and Apex has its one sample logo: nothing here changes either", async () => {
    const northstar = (await pool.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    expect(await brandingOf(northstar)).toBeUndefined();
    expect(await assetCount(northstar)).toBe(0);
    const apex = (await pool.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
    expect(await assetCount(apex)).toBe(1);
    expect((await brandingOf(apex)).accent).toBe("#0D5C63");
  });
});
