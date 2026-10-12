/**
 * Helpers for the Website Builder's browser specs: the Builder's regions by the names a person (and a screen reader) sees, and small reads
 * of what the database holds, so a spec can say "on screen, but not stored yet" and "stored, but not published yet" in one line each.
 */
import type { Locator, Page } from "playwright/test";
import type { Pool } from "pg";
import { expect } from "./saas";

export const canvas = (page: Page): Locator => page.getByTestId("builder-canvas");
export const frame = (page: Page): Locator => page.getByTestId("canvas-frame");
export const statusBadge = (page: Page): Locator => page.getByTestId("builder-status");
export const inspector = (page: Page): Locator => page.getByTestId("builder-inspector");
/** The toast region (the drag-and-drop announcer has role="status" too, and is not this one). */
export const toasts = (page: Page): Locator => page.locator('div[role="status"][aria-live="polite"]');

export const pageItem = (page: Page, key: string): Locator => page.getByTestId(`builder-page-${key}`);
export const sectionRow = (page: Page, key: string): Locator => page.getByTestId(`builder-section-${key}`);
export const sectionPick = (page: Page, key: string): Locator => sectionRow(page, key).getByTestId("section-select");
export const canvasPick = (page: Page, label: string): Locator => canvas(page).getByRole("button", { name: `Select ${label} section` });

export const saveButton = (page: Page): Locator => page.getByRole("button", { name: "Save changes" });
export const discardButton = (page: Page): Locator => page.getByRole("button", { name: "Discard", exact: true });
export const publishButton = (page: Page): Locator => page.getByRole("button", { name: /^Publish (changes|website)$/ });
export const headlineField = (page: Page): Locator => page.getByLabel("Headline", { exact: true });

/** Open the Builder (on a page, by its key) and wait until it is live and the address has settled on the page being edited. */
export async function openBuilder(page: Page, pageKey?: string): Promise<void> {
  await page.goto(pageKey ? `/website/builder?page=${pageKey}` : "/website/builder");
  await expect(page.getByRole("heading", { level: 1, name: "Website Builder" })).toBeVisible();
  await expect(page).toHaveURL(/\/website\/builder\?page=[a-z0-9_-]+$/);
}

/** Save and wait for the stored signal: the button is disabled again once what was sent is the stored Draft. */
export async function saveDraft(page: Page): Promise<void> {
  await saveButton(page).click();
  await expect(toasts(page)).toContainText("Draft saved.");
  await expect(saveButton(page)).toBeDisabled();
}

/** Open a row's "Actions for ..." menu and give back the menu. */
export async function openMenu(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: label }).click();
  const menu = page.getByRole("menu", { name: label });
  await expect(menu).toBeVisible();
  return menu;
}

/** Choose an action from a row's menu. */
export async function chooseAction(page: Page, menuLabel: string, action: string | RegExp): Promise<void> {
  const menu = await openMenu(page, menuLabel);
  await menu.getByRole("menuitem", { name: action }).click();
}

/** The keys of the pages in the page list, in the order shown. */
export const pageOrder = async (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('button[data-testid^="builder-page-"]')].map((element) => (element.getAttribute("data-testid") ?? "").replace(/^builder-page-/, "")));

/** The keys of the sections in the section list of the page being edited, in the order shown. */
export const sectionOrder = async (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('li[data-testid^="builder-section-"]')].map((element) => (element.getAttribute("data-testid") ?? "").replace(/^builder-section-/, "")));

/** The keys of the sections of the page being edited, in the order the canvas draws them. */
export const canvasOrder = async (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid="builder-canvas"] [data-builder-section]')].map((element) => element.getAttribute("data-builder-section") ?? ""));

/* ───────────────────────── what is stored ───────────────────────── */

type State = "draft" | "live";
const versionIs = (state: State) => (state === "draft" ? "v.status = 'draft'" : "v.id = st.published_version_id");

export async function storedSection(db: Pool, organizationId: string, state: State, pageKey: string, sectionKey: string) {
  const rows = (
    await db.query<{ props: Record<string, string>; is_visible: boolean; sort_order: number; label: string; variant: string; type: string }>(
      `select s.props, s.is_visible, s.sort_order, s.label, s.variant, s.type
         from site_sections s join site_pages p on p.id = s.page_id join site_versions v on v.id = p.site_version_id join sites st on st.id = v.site_id
        where st.organization_id = $1 and st.slug = 'main' and ${versionIs(state)} and p.page_key = $2 and s.section_key = $3`,
      [organizationId, pageKey, sectionKey],
    )
  ).rows;
  return rows[0];
}

export async function storedSectionKeys(db: Pool, organizationId: string, state: State, pageKey: string): Promise<string[]> {
  return (
    await db.query<{ section_key: string }>(
      `select s.section_key
         from site_sections s join site_pages p on p.id = s.page_id join site_versions v on v.id = p.site_version_id join sites st on st.id = v.site_id
        where st.organization_id = $1 and st.slug = 'main' and ${versionIs(state)} and p.page_key = $2 order by s.sort_order`,
      [organizationId, pageKey],
    )
  ).rows.map((row) => row.section_key);
}

export async function storedPages(db: Pool, organizationId: string, state: State) {
  return (
    await db.query<{ page_key: string; title: string; slug: string; is_visible: boolean; page_type: string; sort_order: number }>(
      `select p.page_key, p.title, p.slug, p.is_visible, p.page_type, p.sort_order
         from site_pages p join site_versions v on v.id = p.site_version_id join sites st on st.id = v.site_id
        where st.organization_id = $1 and st.slug = 'main' and ${versionIs(state)} order by p.sort_order`,
      [organizationId],
    )
  ).rows;
}

export async function storedTheme(db: Pool, organizationId: string, state: State): Promise<Record<string, unknown>> {
  return (
    await db.query<{ theme: Record<string, unknown> }>(
      `select v.theme from site_versions v join sites st on st.id = v.site_id where st.organization_id = $1 and st.slug = 'main' and ${versionIs(state)}`,
      [organizationId],
    )
  ).rows[0].theme;
}

export const storedHeadline = async (db: Pool, organizationId: string, state: State): Promise<string> => (await storedSection(db, organizationId, state, "home", "hero")).props.headline;

export async function draftRevision(db: Pool, organizationId: string): Promise<number> {
  return (
    await db.query<{ revision: number }>(
      "select v.revision from site_versions v join sites st on st.id = v.site_id where st.organization_id = $1 and st.slug = 'main' and v.status = 'draft'",
      [organizationId],
    )
  ).rows[0].revision;
}

/**
 * A public page as a visitor gets it: no session. (A signed-in member who opens a public page is also given their own workspace, since the
 * workspace's providers wrap every route, so a check that a Draft is not public must not carry the member's session.)
 */
export async function publicPage(page: Page, path: string): Promise<{ status: number; html: string }> {
  const response = await page.request.get(path, { headers: { cookie: "" } });
  return { status: response.status(), html: await response.text() };
}
