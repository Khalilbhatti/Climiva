/**
 * Phase 16: the Website Builder's pages, theme, history, Publish, Draft preview and preview sizes, in the browser. The page list is the
 * site's menu (its order, its hidden pages), the home page and the booking page are structural, addresses are made safe as they are typed and
 * never collide (whatever the capitals), the theme is a handful of tokens that show on the canvas at once, Undo and Redo and the shortcuts are
 * for unsaved work only, Publish publishes exactly the saved Draft, and the canvas is the one renderer at three widths.
 */
import { PREVIEW_MODES } from "../src/components/website/preview-modes";
import { THEME_FONT_LABEL, THEME_FONTS } from "../src/lib/site-theme";
import { expect, test } from "./saas";
import {
  canvas,
  canvasOrder,
  chooseAction,
  frame,
  headlineField,
  inspector,
  openBuilder,
  openMenu,
  pageItem,
  pageOrder,
  publishButton,
  saveButton,
  publicPage,
  saveDraft,
  sectionOrder,
  sectionPick,
  statusBadge,
  storedHeadline,
  storedPages,
  storedSectionKeys,
  storedTheme,
  toasts,
} from "./website-builder-ui";

const LIVE_HEADLINE = "Heating & cooling service when you need it.";
const PAGES = ["home", "services", "about", "contact", "booking"];

/** The links in the canvas's site menu, as a visitor would read them. */
const navOf = (page: import("playwright/test").Page) => canvas(page).locator('header nav a').allTextContents();

test.describe("pages", () => {
  test("a page can be added: a standard page with its own address and one page heading, shown in the site menu, and the Draft's until Save and Publish", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await page.getByRole("button", { name: "Add page" }).click();
    await expect(pageItem(page, "page-1")).toContainText("New page");
    await expect(pageItem(page, "page-1")).toContainText("/new-page");
    await expect(pageItem(page, "page-1")).toHaveAttribute("aria-current", "page");
    await expect(inspector(page)).toHaveAttribute("data-selection", "page");
    expect(await canvasOrder(page)).toEqual(["page_intro-1"]);
    expect(await sectionOrder(page)).toEqual(["page_intro-1"]);
    await expect(canvas(page)).toContainText("A short introduction to this page.");
    expect((await storedPages(db, org, "draft")).map((row) => row.page_key)).toEqual(PAGES);

    // Renaming does not change the address; the address is made safe as it is typed and tidied when the field is left.
    await page.getByLabel("Page title").fill("Spring offers");
    await expect(pageItem(page, "page-1")).toContainText("Spring offers");
    // The page's heading is a section's text of its own: it starts as the title the page was made with, and is edited like any text.
    await sectionPick(page, "page_intro-1").click();
    await page.getByLabel("Heading", { exact: true }).fill("Spring offers");
    await pageItem(page, "page-1").click();
    await expect(pageItem(page, "page-1")).toContainText("/new-page");
    const address = page.getByLabel("Page address");
    await address.fill("Spring Offers!");
    await expect(address).toHaveValue("spring-offers-");
    await address.press("Tab");
    await expect(address).toHaveValue("spring-offers");
    await expect(pageItem(page, "page-1")).toContainText("/spring-offers");
    await expect.poll(() => navOf(page)).toEqual(["Services", "About", "Contact", "Spring offers", "Book service"]);

    await saveDraft(page);
    const stored = (await storedPages(db, org, "draft")).find((row) => row.page_key === "page-1");
    expect(stored).toMatchObject({ title: "Spring offers", slug: "spring-offers", page_type: "content", is_visible: true, sort_order: 5 });
    expect((await storedPages(db, org, "live")).map((row) => row.page_key)).toEqual(PAGES);
    expect((await publicPage(page, `/sites/${workerTenant.platformSlug}/spring-offers`)).status).toBe(404);

    await publishButton(page).click();
    await expect(toasts(page)).toContainText("Website published.");
    await page.goto(`/sites/${workerTenant.platformSlug}/spring-offers`);
    await expect(page.getByRole("heading", { level: 1, name: "Spring offers" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Website" }).getByRole("link", { name: "Spring offers" })).toBeVisible();
  });

  test("the home page is structural: it cannot be deleted, hidden, moved or given another address, each saying why; a copy of it is a standard page", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await pageItem(page, "home").click();
    const reason = "The home page is the address of your website";
    await expect(page.getByLabel("Page address")).toBeDisabled();
    await expect(page.getByLabel("Page address")).toHaveValue("");
    await expect(page.getByRole("switch", { name: "Show Home page" })).toBeDisabled();
    await expect(inspector(page)).toContainText(reason);
    await expect(inspector(page).getByRole("button", { name: "Delete page" })).toHaveAttribute("aria-disabled", "true");
    const menu = await openMenu(page, "Actions for Home page");
    for (const action of ["Move up", "Move down", "Hide page", "Delete page"]) await expect(menu.getByRole("menuitem", { name: action })).toHaveAttribute("aria-disabled", "true");
    await expect(menu).toContainText(reason);
    await menu.getByRole("menuitem", { name: "Delete page" }).click({ force: true });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Delete the Home page/ })).toHaveCount(0);
    expect(await pageOrder(page)).toEqual(PAGES);

    await chooseAction(page, "Actions for Home page", "Duplicate page");
    await expect(pageItem(page, "page-1")).toContainText("Home (copy)");
    await expect(pageItem(page, "page-1")).toContainText("/home-copy");
    await expect(page.getByLabel("Page address")).toBeEnabled();
    expect(await pageOrder(page)).toEqual(["home", "page-1", "services", "about", "contact", "booking"]);
    await saveDraft(page);
    const pages = await storedPages(db, workerTenant.organizationId, "draft");
    expect(pages.filter((row) => row.page_type === "home").map((row) => row.page_key)).toEqual(["home"]);
    expect(pages.filter((row) => row.slug === "")).toHaveLength(1);
    expect(pages.find((row) => row.page_key === "page-1")).toMatchObject({ page_type: "content", slug: "home-copy" });
    expect(await storedSectionKeys(db, workerTenant.organizationId, "draft", "page-1")).toEqual(await storedSectionKeys(db, workerTenant.organizationId, "draft", "home"));
  });

  test("the booking page cannot be deleted or hidden but can be re-addressed, and the site's Book buttons follow its address", async ({ page, db, workerTenant }) => {
    await openBuilder(page, "booking");
    await expect(page.getByRole("switch", { name: "Show Booking page" })).toBeDisabled();
    await expect(inspector(page).getByRole("button", { name: "Delete page" })).toHaveAttribute("aria-disabled", "true");
    await expect(inspector(page)).toContainText("The booking page is where customers choose a Service to book");
    await page.getByLabel("Page address").fill("reserve");
    await expect(canvas(page).locator("header a", { hasText: "Book service" })).toHaveAttribute("href", /\/website\/preview\/reserve$/);
    await saveDraft(page);
    expect((await storedPages(db, workerTenant.organizationId, "draft")).find((row) => row.page_key === "booking")).toMatchObject({ slug: "reserve", page_type: "booking" });
  });

  test("a page can be hidden, shown and deleted: the site menu follows, a deletion asks and can be undone, and Save keeps it all in the Draft only", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page, "contact");
    expect(await navOf(page)).toEqual(["Services", "About", "Contact", "Book service"]);
    await chooseAction(page, "Actions for Contact page", "Hide page");
    await expect(pageItem(page, "contact")).toContainText("Hidden");
    await expect(page.getByText("This page is hidden.")).toBeVisible();
    expect(await navOf(page)).toEqual(["Services", "About", "Book service"]);
    await chooseAction(page, "Actions for Contact page", "Show page");
    expect(await navOf(page)).toEqual(["Services", "About", "Contact", "Book service"]);
    await chooseAction(page, "Actions for Contact page", "Hide page");

    await chooseAction(page, "Actions for About page", "Delete page");
    const dialog = page.getByRole("dialog", { name: "Delete the About page?" });
    await expect(dialog).toContainText("The published website keeps the page until you publish");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await pageOrder(page)).toEqual(PAGES);
    await chooseAction(page, "Actions for About page", "Delete page");
    await page.getByRole("dialog", { name: "Delete the About page?" }).getByRole("button", { name: "Delete page" }).click();
    await expect(toasts(page)).toContainText("About page removed. Undo brings it back.");
    expect(await pageOrder(page)).toEqual(["home", "services", "contact", "booking"]);
    await expect(pageItem(page, "services")).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await pageOrder(page)).toEqual(PAGES);
    await pageItem(page, "about").click();
    expect(await sectionOrder(page)).toEqual(["intro", "business", "values", "details", "bookingCta"]);

    await chooseAction(page, "Actions for About page", "Delete page");
    await page.getByRole("dialog", { name: "Delete the About page?" }).getByRole("button", { name: "Delete page" }).click();
    await saveDraft(page);
    expect((await storedPages(db, org, "draft")).map((row) => [row.page_key, row.is_visible])).toEqual([["home", true], ["services", true], ["contact", false], ["booking", true]]);
    expect(await storedSectionKeys(db, org, "draft", "about")).toEqual([]);
    expect((await storedPages(db, org, "live")).map((row) => row.page_key)).toEqual(PAGES);
    expect(await storedSectionKeys(db, org, "live", "about")).toEqual(["intro", "business", "values", "details", "bookingCta"]);
    // The published site still has its About and Contact pages until Publish.
    expect((await page.request.get(`/sites/${workerTenant.platformSlug}/about`)).status()).toBe(200);
  });

  test("the order of the page list is the order of the site's menu, and Save and Publish carry it to the site", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    const first = await openMenu(page, "Actions for Services page");
    await expect(first.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    await expect(first).toContainText("It is already the first page after Home.");
    await first.getByRole("menuitem", { name: "Move down" }).click();
    expect(await pageOrder(page)).toEqual(["home", "about", "services", "contact", "booking"]);
    expect(await navOf(page)).toEqual(["About", "Services", "Contact", "Book service"]);
    await saveDraft(page);
    expect((await storedPages(db, org, "draft")).map((row) => row.page_key)).toEqual(["home", "about", "services", "contact", "booking"]);

    await publishButton(page).click();
    await expect(toasts(page)).toContainText("Website published.");
    await page.goto(`/sites/${workerTenant.platformSlug}`);
    expect(await page.getByRole("navigation", { name: "Website" }).getByRole("link").allTextContents()).toEqual(["About", "Services", "Contact", "Book service"]);
  });

  test("a page's address and title are checked as they are typed: a reserved word, a taken address (whatever its capitals) and an empty title are marked and keep Save off", async ({ page }) => {
    await openBuilder(page, "about");
    const address = page.getByLabel("Page address");
    await address.fill("login");
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await expect(inspector(page)).toContainText("That address is kept by Climvia. Choose another.");
    await expect(saveButton(page)).toBeDisabled();
    await address.fill("services");
    await expect(inspector(page)).toContainText("Two pages have the same address.");
    await expect(saveButton(page)).toBeDisabled();
    // Capitals are made lower-case as they are typed, so "Services" is the address Services already has.
    await address.fill("Services");
    await expect(address).toHaveValue("services");
    await expect(inspector(page)).toContainText("Two pages have the same address.");
    await address.fill("about-us");
    await expect(address).not.toHaveAttribute("aria-invalid", "true");
    await expect(saveButton(page)).toBeEnabled();
    await page.getByLabel("Page title").fill("");
    await expect(page.getByLabel("Page title")).toHaveAttribute("aria-invalid", "true");
    await expect(inspector(page)).toContainText("A page title is between 1 and 80 characters.");
    await expect(saveButton(page)).toBeDisabled();
    await page.getByLabel("Page title").fill("About us");
    await expect(saveButton(page)).toBeEnabled();
    // A word still being typed ("my-") is not an address until the field is left, and it is tidied then.
    await address.fill("my-");
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await address.press("Tab");
    await expect(address).toHaveValue("my");
    await expect(address).not.toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("the theme", () => {
  const style = (page: import("playwright/test").Page, property: string) => canvas(page).locator("[data-site-theme]").first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name).trim(), property);

  test("the theme is a few named choices that show on the canvas at once, are the Draft's until Save, and reach the site only with Publish", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await page.getByRole("button", { name: "Site theme" }).click();
    await expect(inspector(page)).toHaveAttribute("data-selection", "theme");
    const before = await style(page, "--color-primary");

    // Accent: a colour code (any capitals) or the picker; half a colour is never applied.
    const code = page.getByLabel("Accent colour code");
    await code.fill("#12");
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await expect(inspector(page)).toContainText("Use a colour like #0D5C63.");
    expect(await style(page, "--color-primary")).toBe(before);
    await code.fill("#8b3a1e");
    await expect(code).toHaveValue("#8B3A1E");
    expect(await style(page, "--color-primary")).toBe("#8B3A1E");
    await page.getByLabel("Pick the accent colour").fill("#1f5faf");
    await expect(code).toHaveValue("#1F5FAF");
    await code.fill("#8B3A1E");

    await inspector(page).getByText("Round", { exact: true }).click();
    expect(await style(page, "--radius-btn")).toBe("0.875rem");
    await inspector(page).getByText("Sharp", { exact: true }).click();
    expect(await style(page, "--radius-btn")).toBe("0.25rem");
    await inspector(page).getByText("Round", { exact: true }).click();

    const padding = () => canvas(page).locator("[data-section]").first().evaluate((element) => getComputedStyle(element).paddingTop);
    const roomy = await padding();
    await inspector(page).getByText("Compact", { exact: true }).click();
    await expect(canvas(page).locator('[data-site-density="compact"]').first()).toBeVisible();
    expect(parseFloat(await padding())).toBeLessThan(parseFloat(roomy));

    await inspector(page).getByLabel("Heading font").selectOption({ label: "Classic serif" });
    await inspector(page).getByLabel("Body font").selectOption({ label: "System sans-serif" });
    expect(await canvas(page).locator("h2").first().evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Georgia");
    expect(await canvas(page).locator("p").first().evaluate((element) => getComputedStyle(element).fontFamily)).toContain("system-ui");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    expect(await storedTheme(db, org, "draft")).toMatchObject({ accent: null, radius: "medium" });

    await saveDraft(page);
    expect(await storedTheme(db, org, "draft")).toEqual({ schema: 1, accent: "#8B3A1E", radius: "large", density: "compact", headingFont: "serif", bodyFont: "system-sans" });
    expect(await storedTheme(db, org, "live")).toEqual({ schema: 1, accent: null, radius: "medium", density: "comfortable", headingFont: "inter", bodyFont: "inter" });

    // The signed-in Draft preview wears the theme; a visitor does not see it until Publish.
    const preview = await page.context().newPage();
    await preview.goto("/website/preview");
    await expect(preview.getByTestId("site-frame")).toHaveAttribute("data-site-density", "compact");
    expect(await preview.getByTestId("site-frame").evaluate((element) => getComputedStyle(element).getPropertyValue("--color-primary").trim())).toBe("#8B3A1E");
    await preview.close();
    const visit = async () => (await publicPage(page, `/sites/${workerTenant.platformSlug}`)).html;
    expect(await visit()).not.toContain("#8B3A1E");
    await publishButton(page).click();
    await expect(toasts(page)).toContainText("Website published.");
    const published = await visit();
    expect(published).toContain("#8B3A1E");
    expect(published).toContain('data-site-density="compact"');
  });

  test("only the listed choices exist: three fonts by name, no free text but the colour code, and the default can be restored", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("button", { name: "Site theme" }).click();
    for (const field of ["Heading font", "Body font"]) {
      expect(await inspector(page).getByLabel(field).locator("option").allTextContents()).toEqual(THEME_FONTS.map((font) => THEME_FONT_LABEL[font]));
    }
    // The only thing typed in is the colour code: no CSS, no class, no font address, no upload.
    await expect(inspector(page).locator('input:not([type="radio"]):not([type="color"]), textarea')).toHaveCount(1);
    await expect(inspector(page).locator('input[type="file"], textarea')).toHaveCount(0);
    const before = await canvas(page).locator("[data-site-theme]").first().evaluate((element) => getComputedStyle(element).getPropertyValue("--color-primary").trim());
    await page.getByLabel("Accent colour code").fill("#8B3A1E");
    await inspector(page).getByRole("button", { name: "Use the default" }).click();
    await expect(page.getByLabel("Accent colour code")).toHaveValue("");
    expect(await canvas(page).locator("[data-site-theme]").first().evaluate((element) => getComputedStyle(element).getPropertyValue("--color-primary").trim())).toBe(before);
    await expect(statusBadge(page)).toHaveText("Published");
    // A change to the theme is a step of history like any other.
    await inspector(page).getByText("Round", { exact: true }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(inspector(page).getByRole("radio", { name: "Soft" })).toBeChecked();
  });
});

test.describe("Undo, Redo and the shortcuts", () => {
  test("history is for unsaved work: Save starts it again, and Ctrl+S saves from anywhere, even a text field", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByRole("dialog", { name: "Add a section" }).getByRole("button", { name: /^Contact form/ }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();

    // In a text field Ctrl+Z is the field's own: it never takes a section away.
    const heading = page.getByLabel("Heading", { exact: true });
    await heading.click();
    await page.keyboard.press("Control+z");
    expect(await sectionOrder(page)).toContain("contact_form-1");

    // Ctrl+S saves while the cursor is in the field.
    await heading.fill("Write to us");
    await page.keyboard.press("Control+s");
    await expect(toasts(page)).toContainText("Draft saved.");
    await expect(saveButton(page)).toBeDisabled();
    expect((await storedSectionKeys(db, org, "draft", "home"))).toContain("contact_form-1");
    // After a save there is nothing to undo: what is stored is the baseline.
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await page.getByRole("heading", { level: 1, name: "Website Builder" }).click();
    await page.keyboard.press("Control+z");
    expect(await sectionOrder(page)).toContain("contact_form-1");
  });

  test("there is no shortcut that publishes: the keys that look like one do nothing", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await sectionPick(page, "hero").click();
    await headlineField(page).fill("Not published by a key");
    await page.keyboard.press("Control+s");
    await expect(toasts(page)).toContainText("Draft saved.");
    for (const keys of ["Control+Shift+P", "Control+Enter", "Control+Shift+Enter", "Alt+P", "Control+Alt+P"]) await page.keyboard.press(keys);
    await page.waitForTimeout(500);
    await expect(toasts(page)).not.toContainText("Website published.");
    expect(await storedHeadline(db, workerTenant.organizationId, "live")).toBe(LIVE_HEADLINE);
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
  });
});

test.describe("Publish", () => {
  test("Publish is the saved Draft only: off while anything is unsaved, one step after Save, and it leaves nothing newer", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    // Nothing new: nothing to publish.
    await expect(publishButton(page)).toBeDisabled();
    await sectionPick(page, "hero").click();
    await headlineField(page).fill("Published from the Builder");
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.getByText("Save your changes before publishing.")).toBeAttached();
    await saveDraft(page);
    await expect(publishButton(page)).toHaveText("Publish changes");
    await expect(publishButton(page)).toBeEnabled();
    const versions = async () => (await db.query<{ n: number }>("select count(*)::int as n from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'published'", [org])).rows[0].n;
    expect(await versions()).toBe(1);

    await publishButton(page).click();
    await expect(toasts(page)).toContainText("Website published.");
    await expect(statusBadge(page)).toHaveText("Published");
    await expect(publishButton(page)).toBeDisabled();
    expect(await versions()).toBe(2);
    expect(await storedHeadline(db, org, "live")).toBe("Published from the Builder");
    expect((await publicPage(page, `/sites/${workerTenant.platformSlug}`)).html).toContain("Published from the Builder");
    await expect(page.getByRole("link", { name: "View published site" })).toHaveAttribute("href", `/sites/${workerTenant.platformSlug}`);
    // A further edit makes the Draft newer again, and the status says so.
    await headlineField(page).fill("A newer draft");
    await saveDraft(page);
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
    expect(await storedHeadline(db, org, "live")).toBe("Published from the Builder");
  });

  test("View published site goes to the page's own published address, and the Draft preview link to the saved Draft of that page", async ({ page, context, workerTenant }) => {
    await openBuilder(page, "services");
    await expect(page.getByRole("link", { name: "View published site" })).toHaveAttribute("href", `/sites/${workerTenant.platformSlug}/services`);
    await expect(page.getByRole("link", { name: "View published site" })).toHaveAttribute("target", "_blank");
    await sectionPick(page, "intro").click();
    await page.getByLabel("Heading", { exact: true }).fill("Services from the Draft");
    await expect(page.getByRole("button", { name: "Preview" })).toBeDisabled();
    await saveDraft(page);
    const link = page.getByRole("link", { name: "Preview" });
    await expect(link).toHaveAttribute("href", "/website/preview/services");
    await expect(link).toHaveAttribute("target", "_blank");
    const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await tab.waitForLoadState();
    await expect(tab.getByRole("heading", { level: 1, name: "Services from the Draft" })).toBeVisible();
    await expect(tab.getByRole("link", { name: "Back to editor" })).toHaveAttribute("href", "/website/builder?page=services");
    await tab.getByRole("link", { name: "Back to editor" }).click();
    await expect(tab).toHaveURL(/\/website\/builder\?page=services$/);
    await expect(tab.getByTestId("builder-status")).toHaveText("Draft newer than published");
    await tab.close();
    expect((await publicPage(page, `/sites/${workerTenant.platformSlug}/services`)).html).not.toContain("Services from the Draft");
  });

  test("the Draft preview is drawn at the same three widths as the Builder's canvas", async ({ page }) => {
    await page.goto("/website/preview");
    for (const mode of PREVIEW_MODES) {
      await page.getByRole("group", { name: "Preview size" }).getByRole("button", { name: mode.label }).click();
      await expect(page.getByTestId("site-frame")).toHaveAttribute("data-mode", mode.id);
      await expect(page.getByTestId("site-frame")).toHaveCSS("max-width", `${mode.width}px`);
    }
  });
});

test.describe("preview sizes and the Builder at every size", () => {
  test("Desktop, Tablet and Mobile are one renderer at three widths: the same page, never stored, with the layout following the width", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    const group = page.getByRole("group", { name: "Preview size" });
    await expect(group.getByRole("button")).toHaveText(PREVIEW_MODES.map((mode) => mode.label));
    for (const mode of PREVIEW_MODES) await expect(group.getByRole("button", { name: mode.label })).toHaveAttribute("title", `${mode.label}, ${mode.width} pixels wide`);
    await expect(group.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "true");
    await expect(frame(page)).toHaveAttribute("data-mode", "desktop");

    // An edit and a selection are kept across sizes, and a size is not an edit.
    await sectionPick(page, "hero").click();
    await headlineField(page).fill("Seen at every width");
    const cards = canvas(page).locator("li").filter({ hasText: /AC Repair & Diagnostics|Annual Cooling Tune-Up/ });
    const columns = async () => {
      const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
      return Math.abs(a!.x - b!.x) < 2 ? 1 : 2;
    };
    const widths: Record<string, number> = {};
    for (const mode of PREVIEW_MODES) {
      await group.getByRole("button", { name: mode.label }).click();
      await expect(group.getByRole("button", { name: mode.label })).toHaveAttribute("aria-pressed", "true");
      await expect(frame(page)).toHaveAttribute("data-mode", mode.id);
      const scale = Number(await frame(page).getAttribute("data-scale"));
      expect(scale).toBeGreaterThan(0.29);
      expect(scale).toBeLessThanOrEqual(1);
      const box = (await frame(page).boundingBox())!;
      expect(Math.abs(box.width - mode.width * scale), mode.label).toBeLessThan(3);
      widths[mode.id] = mode.width;
      await expect(canvas(page)).toContainText("Seen at every width");
      await expect(statusBadge(page)).toHaveText("Unsaved changes");
      await expect(inspector(page)).toHaveAttribute("data-selection", "section");
      if (mode.id === "mobile") expect(await columns()).toBe(1);
      else expect(await columns()).toBe(2);
    }
    expect(Object.values(widths)).toEqual([...PREVIEW_MODES].map((mode) => mode.width));
    expect(await storedHeadline(db, workerTenant.organizationId, "draft")).toBe(LIVE_HEADLINE);
  });

  test("the side panels can be hidden to give the page more room, and the Builder never needs sideways scrolling at any width", async ({ page }) => {
    await openBuilder(page);
    const scale = async () => Number(await frame(page).getAttribute("data-scale"));
    const narrow = await scale();
    await page.getByRole("button", { name: "Pages and sections panel" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pages" })).toBeHidden();
    await page.getByRole("button", { name: "Inspector panel" }).click();
    await expect(page.getByTestId("builder-inspector")).toBeHidden();
    await expect.poll(scale).toBeGreaterThan(narrow);
    await page.getByRole("button", { name: "Pages and sections panel" }).click();
    await page.getByRole("button", { name: "Inspector panel" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pages" })).toBeVisible();

    for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [800, 900], [768, 1024]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole("heading", { level: 1, name: "Website Builder" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px wide`).toBeLessThanOrEqual(1);
      // Every region is there: the page list, the section list, the page itself and the inspector.
      for (const name of ["Pages", "Sections"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
      await expect(page.getByTestId("builder-canvas")).toBeVisible();
      await expect(page.getByTestId("builder-inspector")).toBeAttached();
    }
  });
});
