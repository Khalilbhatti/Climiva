/**
 * Phase 16: the visual Website Builder, in the browser. This file is how a person gets into it, what they can select and how the inspector
 * follows the section registry, editing text with Save and Discard (nothing is stored on a keystroke, nothing published until Publish), and
 * working on sections: add, copy, remove with Undo, hide and show, change style, and reorder by drag and by keyboard. Pages, the theme,
 * Publish and the preview sizes are in website-builder-pages.spec.ts; stale tabs, leaving with unsaved work, the canvas's safety,
 * accessibility and who can reach what are in website-builder-safety.spec.ts.
 */
import { randomBytes } from "node:crypto";
import { withTenant } from "../src/db/tenant";
import { addSection } from "../src/lib/site-builder";
import { SECTION_CATEGORIES, SECTION_LIBRARY, SECTION_REGISTRY, defaultPropsFor, fieldLabel, fieldsOf, variantLabel, type SectionType } from "../src/lib/site-sections";
import { NORTHSTAR_CONTENT, SERVICES } from "./apex-data";
import { editDraft } from "./draft-edits";
import { NOT_SIGNED_IN, completeOnboarding, expect, signUp, test } from "./saas";
import {
  canvas,
  canvasOrder,
  canvasPick,
  chooseAction,
  discardButton,
  headlineField,
  inspector,
  openBuilder,
  openMenu,
  pageItem,
  publishButton,
  saveButton,
  saveDraft,
  sectionOrder,
  sectionPick,
  sectionRow,
  statusBadge,
  storedHeadline,
  storedSection,
  storedSectionKeys,
  toasts,
} from "./website-builder-ui";

const LIVE_HEADLINE = "Heating & cooling service when you need it.";
const HOME = ["hero", "services", "why", "hours", "contact", "bookingCta"];

test.describe("opening the Builder", () => {
  test("it opens on Home inside the workspace shell: the pages, the sections, the page itself and what is stored", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await expect(page).toHaveURL(/\/website\/builder\?page=home$/);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Website/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Back to Website" })).toHaveAttribute("href", "/website");
    await expect(page.getByRole("banner").getByText("Apex Climate Heating & Air")).toBeVisible();
    await expect(page.getByTestId("builder-status")).toHaveText("Published");

    for (const [key, title, path] of [
      ["home", "Home", "/"],
      ["services", "Services", "/services"],
      ["about", "About", "/about"],
      ["contact", "Contact", "/contact"],
      ["booking", "Booking", "/booking"],
    ]) {
      await expect(pageItem(page, key)).toContainText(title);
      await expect(pageItem(page, key)).toContainText(path);
    }
    await expect(pageItem(page, "home")).toHaveAttribute("aria-current", "page");
    expect(await sectionOrder(page)).toEqual(HOME);
    expect(await canvasOrder(page)).toEqual(HOME);
    await expect(canvas(page)).toContainText(LIVE_HEADLINE);
    // Nothing is selected for editing but the page, and nothing is unsaved.
    await expect(inspector(page)).toHaveAttribute("data-selection", "page");
    await expect(saveButton(page)).toBeDisabled();
    expect(await storedHeadline(db, workerTenant.organizationId, "draft")).toBe(LIVE_HEADLINE);
  });

  test("a page can be chosen by address, and choosing another page changes the address without a reload, keeping unsaved work", async ({ page }) => {
    await openBuilder(page, "services");
    await expect(pageItem(page, "services")).toHaveAttribute("aria-current", "page");
    await expect(canvas(page)).toContainText("AC Repair & Diagnostics");
    await page.evaluate(() => ((window as unknown as { __builder?: number }).__builder = 1));

    await sectionPick(page, "intro").click();
    await page.getByLabel("Heading", { exact: true }).fill("Services, edited");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");

    await pageItem(page, "about").click();
    await expect(page).toHaveURL(/\/website\/builder\?page=about$/);
    await expect(pageItem(page, "about")).toHaveAttribute("aria-current", "page");
    expect(await sectionOrder(page)).toEqual(["intro", "business", "values", "details", "bookingCta"]);
    await pageItem(page, "services").click();
    await expect(page).toHaveURL(/page=services$/);
    // Nothing reloaded, and the edit made on the first page is still there.
    expect(await page.evaluate(() => (window as unknown as { __builder?: number }).__builder)).toBe(1);
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    await expect(canvas(page)).toContainText("Services, edited");
    await sectionPick(page, "intro").click();
    await expect(page.getByLabel("Heading", { exact: true })).toHaveValue("Services, edited");
  });

  test("an unknown page is not found, the old editor's address lands in the Builder, and the page lists lead into it", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/website/builder?page=pricing");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();

    await page.goto("/website/pages/about");
    await expect(page).toHaveURL(/\/website\/builder\?page=about$/);
    await expect(page.getByRole("heading", { level: 1, name: "Website Builder" })).toBeVisible();
    await expect(pageItem(page, "about")).toHaveAttribute("aria-current", "page");

    await page.goto("/website/pages");
    await expect(page.getByRole("region", { name: "Website pages" }).getByRole("link", { name: "Edit Services page" })).toHaveAttribute("href", "/website/builder?page=services");
    await page.goto("/website");
    for (const link of await page.getByRole("link", { name: "Edit website" }).all()) await expect(link).toHaveAttribute("href", "/website/builder");
    await page.getByRole("link", { name: "Edit website" }).first().click();
    await expect(page).toHaveURL(/\/website\/builder\?page=home$/);
  });

  test("another business opens its own website: nothing of the Apex site is in it", async ({ openAs }) => {
    const taylor = await openAs("taylor");
    await openBuilder(taylor.page);
    const hero = NORTHSTAR_CONTENT.pages.find((entry) => entry.key === "home")!.sections.find((section) => section.key === "hero")!;
    await expect(canvas(taylor.page)).toContainText(hero.props.headline);
    await expect(taylor.page.locator("body")).not.toContainText("Apex");
    await expect(taylor.page.locator("body")).not.toContainText(LIVE_HEADLINE);
    await expect(taylor.page.getByRole("link", { name: "View published site" })).toHaveAttribute("href", /\/sites\/northstar/);
    expect(taylor.problems).toEqual([]);
  });

  test("a member who may not change the website can look and select, and nothing that changes it works", async ({ openAs }) => {
    const jamie = await openAs("jamie");
    const view = jamie.page;
    await openBuilder(view);
    await expect(view.getByText("You can look at this website. Only an owner or admin can change it.")).toBeVisible();
    for (const name of ["Save changes", "Discard", "Add section", "Add page"]) await expect(view.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(publishButton(view)).toHaveCount(0);
    await expect(view.getByRole("button", { name: "Undo" })).toBeDisabled();

    await canvasPick(view, "Hero").click();
    await expect(inspector(view)).toHaveAttribute("data-selection", "section");
    await expect(headlineField(view)).toBeDisabled();
    await expect(view.getByLabel("Section name")).toBeDisabled();
    await expect(view.getByRole("switch", { name: "Show Hero section" })).toBeDisabled();
    await expect(view.getByRole("toolbar", { name: "Section actions" })).toHaveCount(0);
    await expect(view.getByRole("button", { name: "Reorder Hero section" })).toBeDisabled();
    const menu = await openMenu(view, "Actions for Hero section");
    for (const action of ["Move down", "Duplicate", "Hide section", "Delete section"]) {
      await expect(menu.getByRole("menuitem", { name: action })).toHaveAttribute("aria-disabled", "true");
    }
    await expect(menu).toContainText("Only an owner or admin can change the website.");
    await view.keyboard.press("Escape");
    // Looking is allowed: another page and the theme open.
    await pageItem(view, "about").click();
    await view.getByRole("button", { name: "Site theme" }).click();
    await expect(view.getByLabel("Heading font")).toBeDisabled();
    expect(jamie.problems).toEqual([]);
  });
});

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 120_000 });

  test("gets a Builder on its own starter Draft: its own name in neutral copy, never Apex's, private until it publishes", async ({ page }) => {
    const name = `Fresh Start Air ${randomBytes(3).toString("hex")}`;
    await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name, phone: "(303) 555-0199", email: "hello@freshstart.test", street: "77 Pine Street", city: "Boulder", state: "CO", zip: "80301" });
    await openBuilder(page);
    await expect(page.getByTestId("builder-status")).toHaveText("Draft saved");
    await expect(canvas(page)).toContainText(name);
    await expect(page.locator("body")).not.toContainText("Apex");
    expect(await sectionOrder(page)).toEqual(HOME);
    // Nothing is published yet: there is no published site to view, and the way forward is Publish.
    await expect(page.getByRole("link", { name: "View published site" })).toHaveCount(0);
    await expect(publishButton(page)).toHaveText("Publish website");
    await expect(publishButton(page)).toBeEnabled();
  });
});

test.describe("selecting", () => {
  test("a selection is the same in the canvas, the section list and the inspector, whichever it was made in", async ({ page }) => {
    await openBuilder(page);
    await canvasPick(page, "Services").click();
    await expect(inspector(page)).toHaveAttribute("data-selection", "section");
    await expect(inspector(page).getByRole("heading", { level: 2, name: "Services" })).toBeVisible();
    await expect(sectionPick(page, "services")).toHaveAttribute("aria-current", "true");
    await expect(canvasPick(page, "Services")).toHaveAttribute("aria-pressed", "true");
    await expect(canvasPick(page, "Hero")).toHaveAttribute("aria-pressed", "false");

    // From the list: the canvas follows, and the section is brought into view.
    await sectionPick(page, "bookingCta").click();
    await expect(canvasPick(page, "Booking CTA")).toHaveAttribute("aria-pressed", "true");
    await expect(canvasPick(page, "Services")).toHaveAttribute("aria-pressed", "false");
    await expect(canvasPick(page, "Booking CTA")).toBeInViewport();
    await expect(inspector(page).getByRole("heading", { level: 2, name: "Booking CTA" })).toBeVisible();

    // A page and the theme are selections too.
    await pageItem(page, "home").click();
    await expect(inspector(page)).toHaveAttribute("data-selection", "page");
    await expect(canvas(page).locator('[aria-pressed="true"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Site theme" }).click();
    await expect(inspector(page)).toHaveAttribute("data-selection", "theme");
    await expect(page.getByRole("button", { name: "Site theme" })).toHaveAttribute("aria-pressed", "true");
  });

  test("a selection follows a section's identity, not its name or position: renaming and moving it keep it selected", async ({ page }) => {
    await openBuilder(page);
    await sectionPick(page, "hero").click();
    await page.getByLabel("Section name").fill("Top banner");
    await expect(sectionRow(page, "hero")).toContainText("Top banner");
    await expect(canvasPick(page, "Top banner")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("builder-inspector").getByRole("heading", { level: 2, name: "Top banner" })).toBeVisible();
    await chooseAction(page, "Actions for Top banner section", "Move down");
    expect(await sectionOrder(page)).toEqual(["services", "hero", "why", "hours", "contact", "bookingCta"]);
    await expect(canvasPick(page, "Top banner")).toHaveAttribute("aria-pressed", "true");
    await expect(sectionPick(page, "hero")).toHaveAttribute("aria-current", "true");
  });

  test("the inspector's controls are the ones the registry declares for the section's type and style: nothing is written per section", async ({ page }) => {
    await openBuilder(page);
    const expectFields = async (key: string, type: SectionType, variant: string) => {
      await sectionPick(page, key).click();
      const fields = fieldsOf(type, variant);
      for (const field of fields) {
        const label = fieldLabel(type, variant, field);
        if (field.kind === "align") await expect(inspector(page).getByRole("group", { name: label })).toBeVisible();
        else await expect(inspector(page).getByLabel(label, { exact: true }), `${key}: ${label}`).toBeVisible();
      }
      // Besides the section's name, exactly the declared texts can be typed into.
      await expect(inspector(page).getByRole("textbox")).toHaveCount(1 + fields.filter((field) => field.kind !== "align").length);
    };
    await expectFields("hero", "hero", "default");
    await expectFields("services", "service_list", "cards");
    await expectFields("why", "feature_list", "icons");
    await expectFields("hours", "business_hours", "card");
    await expectFields("contact", "contact_details", "card");
    await expectFields("bookingCta", "call_to_action", "default");
    await pageItem(page, "contact").click();
    await expectFields("form", "contact_form", "default");

    // A style choice exists only where the type has more than one.
    await sectionPick(page, "form").click();
    await expect(inspector(page).getByLabel("Style")).toHaveCount(0);
    await pageItem(page, "home").click();
    await sectionPick(page, "services").click();
    const options = await inspector(page).getByLabel("Style").locator("option").allTextContents();
    expect(options).toEqual(SECTION_REGISTRY.service_list.variants.map((variant) => variantLabel("service_list", variant.id)));
  });

  test("what is connected to the business is read, never retyped: the inspector says where to manage it and offers no copy of it", async ({ page }) => {
    await openBuilder(page);
    await sectionPick(page, "hours").click();
    await expect(inspector(page)).toContainText("Managed in Business Settings");
    await expect(inspector(page).getByRole("link", { name: "Business hours" })).toHaveAttribute("href", "/settings/hours");
    await sectionPick(page, "contact").click();
    await expect(inspector(page)).toContainText("Managed in Business Settings");
    await expect(inspector(page).getByRole("link", { name: "Business information" })).toHaveAttribute("href", "/settings");
    // Nothing to type but the section's name: no phone, email, address or hours field exists in the Builder.
    await expect(inspector(page).getByRole("textbox")).toHaveCount(1);
    await expect(page.getByRole("main").getByLabel(/phone|email|address|opening hours/i)).toHaveCount(0);

    await sectionPick(page, "services").click();
    await expect(inspector(page)).toContainText("Services come directly from your Service catalog");
    await expect(inspector(page).getByRole("link", { name: "Manage Services" })).toHaveAttribute("href", "/services");
    for (const service of SERVICES) await expect(inspector(page).getByRole("switch", { name: `Show ${service.name} on the website` })).toBeChecked();

    await pageItem(page, "booking").click();
    await sectionPick(page, "experience").click();
    await expect(inspector(page)).toContainText("Each Service sets how customers book it");
    await pageItem(page, "contact").click();
    await sectionPick(page, "form").click();
    await expect(inspector(page)).toContainText("Messages sent from this form are not delivered yet");
  });

  test("which Services the website shows and in what order is edited as references, for the whole site, and the catalog is untouched", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await sectionPick(page, "services").click();
    const first = SERVICES[0].name;
    const second = SERVICES[1].name;
    await inspector(page).getByRole("switch", { name: `Show ${first} on the website` }).click();
    await inspector(page).getByRole("button", { name: `Move ${second} up` }).click();
    await expect(canvas(page)).not.toContainText(first);
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    const catalog = async () => JSON.stringify((await db.query("select slug, name, price_amount, is_active, visibility from services where organization_id = $1 order by slug", [workerTenant.organizationId])).rows);
    const before = await catalog();
    await saveDraft(page);
    const settings = (await db.query<{ settings: { serviceDisplay: { order: string[]; hidden: string[] } } }>("select v.settings from site_versions v join sites s on s.id = v.site_id where s.organization_id = $1 and s.slug = 'main' and v.status = 'draft'", [workerTenant.organizationId])).rows[0].settings;
    expect(settings.serviceDisplay.hidden).toEqual([SERVICES[0].id]);
    expect(settings.serviceDisplay.order[0]).toBe(SERVICES[1].id);
    expect(await catalog()).toBe(before);
    // The same list for every page that shows Services: the Services page's catalog follows it too.
    await pageItem(page, "services").click();
    await expect(canvas(page)).not.toContainText(first);
  });
});

test.describe("editing text, Save and Discard", () => {
  test("an edit is on screen at once and unsaved; nothing is stored until Save, nothing is published until Publish, and it survives a reload", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Cool homes, fair prices");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    await expect(canvas(page)).toContainText("Cool homes, fair prices");
    await expect(saveButton(page)).toBeEnabled();
    await expect(discardButton(page)).toBeEnabled();
    // While there is something unsaved, the Draft preview and Publish are off: they would show or publish something else.
    await expect(page.getByRole("button", { name: "Preview" })).toBeDisabled();
    await expect(publishButton(page)).toBeDisabled();
    // Typing is not saving: after a pause, nothing has been stored.
    await page.waitForTimeout(1200);
    expect(await storedHeadline(db, org, "draft")).toBe(LIVE_HEADLINE);

    await saveDraft(page);
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
    expect(await storedHeadline(db, org, "draft")).toBe("Cool homes, fair prices");
    expect(await storedHeadline(db, org, "live")).toBe(LIVE_HEADLINE);
    await expect(page.getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/website/preview");
    await expect(publishButton(page)).toBeEnabled();
    // The public page still has the published headline.
    const visitor = await page.request.get(`/sites/${workerTenant.platformSlug}`, { headers: { cookie: "" } });
    expect(await visitor.text()).toContain("Heating &amp; cooling service when you need it.");
    expect(await visitor.text()).not.toContain("Cool homes, fair prices");

    await page.reload();
    await canvasPick(page, "Hero").click();
    await expect(headlineField(page)).toHaveValue("Cool homes, fair prices");
    await expect(statusBadge(page)).toHaveText("Draft newer than published");
  });

  test("Discard asks first, then puts the stored Draft back without a reload, and leaves nothing to undo or save", async ({ page }) => {
    await openBuilder(page);
    await page.evaluate(() => ((window as unknown as { __builder?: number }).__builder = 7));
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Something else");
    await page.getByLabel("Section name").fill("Renamed");
    await discardButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toContainText("The published website is not affected.");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(headlineField(page)).toHaveValue("Something else");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");

    await discardButton(page).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(toasts(page)).toContainText("Unsaved changes discarded.");
    await expect(headlineField(page)).toHaveValue(LIVE_HEADLINE);
    await expect(page.getByLabel("Section name")).toHaveValue("Hero");
    await expect(statusBadge(page)).toHaveText("Published");
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(await page.evaluate(() => (window as unknown as { __builder?: number }).__builder)).toBe(7);
  });

  test("a text the server would refuse is refused on screen first: marked on its field, and Save stays off until it is fixed", async ({ page }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    for (const bad of ["", "<b>bold</b>", "javascript:alert(1)", "onclick = alert(1)", "Hello {{business.phone}}"]) {
      await headlineField(page).fill(bad);
      await expect(headlineField(page), JSON.stringify(bad)).toHaveAttribute("aria-invalid", "true");
      await expect(saveButton(page), JSON.stringify(bad)).toBeDisabled();
      // Markup is never turned into elements, not even on the canvas.
      await expect(canvas(page).locator("b")).toHaveCount(0);
    }
    await headlineField(page).fill("A good headline");
    await expect(headlineField(page)).not.toHaveAttribute("aria-invalid", "true");
    await expect(saveButton(page)).toBeEnabled();
    // Another section's problem is shown on that section and still keeps Save off.
    await sectionPick(page, "bookingCta").click();
    await page.getByLabel("Button label").fill("");
    await expect(page.getByLabel("Button label")).toHaveAttribute("aria-invalid", "true");
    await expect(saveButton(page)).toBeDisabled();
  });

  test("the two business tokens are stored as typed and filled when the page is drawn, so a rename is followed", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Welcome to {{business.name}}");
    await expect(canvas(page)).toContainText("Welcome to Apex Climate Heating & Air");
    await saveDraft(page);
    expect((await storedSection(db, workerTenant.organizationId, "draft", "home", "hero")).props.headline).toBe("Welcome to {{business.name}}");
  });
});

test.describe("sections", () => {
  test("a section can be added from the library: only registered kinds are offered, it starts with their text, and it is the Draft's until Save", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await page.getByRole("button", { name: "Add section" }).click();
    const library = page.getByRole("dialog", { name: "Add a section" });
    for (const category of SECTION_CATEGORIES) await expect(library.getByRole("heading", { name: category.label })).toBeVisible();
    await expect(library.getByRole("button")).toHaveCount(SECTION_LIBRARY.length + 1); // every registered kind, and the dialog's own close button
    for (const entry of SECTION_LIBRARY) await expect(library.getByRole("button", { name: entry.label }).first()).toBeVisible();

    await library.getByRole("button", { name: /^Contact form/ }).click();
    await expect(library).not.toBeVisible();
    expect(await sectionOrder(page)).toEqual(["hero", "contact_form-1", "services", "why", "hours", "contact", "bookingCta"]);
    expect(await canvasOrder(page)).toEqual(await sectionOrder(page));
    await expect(sectionPick(page, "contact_form-1")).toHaveAttribute("aria-current", "true");
    await expect(canvas(page)).toContainText("Send us a message");
    await expect(inspector(page).getByRole("heading", { level: 2, name: "Contact form" })).toBeVisible();
    // The Draft has not changed: the new section is on screen only.
    expect(await storedSectionKeys(db, org, "draft", "home")).toEqual(HOME);

    await saveDraft(page);
    expect(await storedSectionKeys(db, org, "draft", "home")).toEqual(["hero", "contact_form-1", ...HOME.slice(1)]);
    expect((await storedSection(db, org, "draft", "home", "contact_form-1")).props).toEqual(defaultPropsFor("contact_form", "default"));
    expect(await storedSectionKeys(db, org, "live", "home")).toEqual(HOME);
  });

  test("a section can be copied and removed: the copy is its own, a removal says so and Undo (button or keys) brings it back", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await chooseAction(page, "Actions for Hero section", "Duplicate");
    expect(await sectionOrder(page)).toEqual(["hero", "hero-copy", ...HOME.slice(1)]);
    await expect(sectionPick(page, "hero-copy")).toHaveAttribute("aria-current", "true");
    await headlineField(page).fill("Only the copy");
    await expect(canvas(page).getByText(LIVE_HEADLINE)).toHaveCount(1);
    await expect(canvas(page).getByText("Only the copy")).toHaveCount(1);

    await inspector(page).getByRole("button", { name: "Delete section" }).click();
    await expect(toasts(page)).toContainText("Hero section removed. Undo brings it back.");
    expect(await sectionOrder(page)).toEqual(HOME);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await sectionOrder(page)).toEqual(["hero", "hero-copy", ...HOME.slice(1)]);
    await sectionPick(page, "hero-copy").click();
    await expect(headlineField(page)).toHaveValue("Only the copy");

    // The keyboard does the same: Ctrl+Z steps back through the edit, Ctrl+Shift+Z forward again.
    await page.getByRole("button", { name: "Undo" }).focus();
    await page.keyboard.press("Control+z");
    await expect(headlineField(page)).toHaveValue(LIVE_HEADLINE);
    await page.keyboard.press("Control+Shift+z");
    await expect(headlineField(page)).toHaveValue("Only the copy");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    expect(await sectionOrder(page)).toEqual(HOME);
    await expect(statusBadge(page)).toHaveText("Published");
    await page.keyboard.press("Control+y");
    expect(await sectionOrder(page)).toEqual(["hero", "hero-copy", ...HOME.slice(1)]);
    expect(await storedSectionKeys(db, workerTenant.organizationId, "draft", "home")).toEqual(HOME);
  });

  test("a section the page cannot do without stays: its Delete and Hide say why and do nothing, wherever they are offered", async ({ page }) => {
    await openBuilder(page, "booking");
    const reason = "The booking page needs a visible list of Services";
    await canvasPick(page, "Booking experience").click();
    await expect(inspector(page).getByRole("switch", { name: "Show Booking experience section" })).toBeDisabled();
    await expect(inspector(page)).toContainText(reason);
    await expect(inspector(page).getByRole("button", { name: "Delete section" })).toHaveAttribute("aria-disabled", "true");
    await expect(canvas(page).getByRole("toolbar", { name: "Section actions" }).getByRole("button", { name: "Delete section" })).toHaveAttribute("aria-disabled", "true");
    const menu = await openMenu(page, "Actions for Booking experience section");
    await expect(menu.getByRole("menuitem", { name: /Hide section/ })).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByRole("menuitem", { name: /Delete section/ })).toContainText(reason);
    await menu.getByRole("menuitem", { name: /Delete section/ }).click({ force: true });
    await page.keyboard.press("Escape");
    await expect(sectionRow(page, "experience")).toBeVisible();
    await expect(statusBadge(page)).toHaveText("Published");
    // The first section cannot move up, and the reason is given.
    const first = await openMenu(page, "Actions for Page intro section");
    await expect(first.getByRole("menuitem", { name: /Move up/ })).toHaveAttribute("aria-disabled", "true");
    await expect(first).toContainText("It is already the first section.");
  });

  test("a section can be hidden and shown: it stays in the Draft, shows as hidden, and a visitor sees it gone only after Publish", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await sectionPick(page, "services").click();
    await inspector(page).getByRole("switch", { name: "Show Services section" }).click();
    await expect(canvas(page).getByText("Hidden · Services")).toBeVisible();
    await expect(canvas(page)).not.toContainText("Our HVAC Services");
    await expect(sectionRow(page, "services")).toContainText("Hidden");
    expect((await storedSection(db, org, "draft", "home", "services")).is_visible).toBe(true);

    await saveDraft(page);
    expect((await storedSection(db, org, "draft", "home", "services")).is_visible).toBe(false);
    expect((await storedSection(db, org, "live", "home", "services")).is_visible).toBe(true);
    const preview = await page.context().newPage();
    await preview.goto("/website/preview");
    await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(preview.locator("body")).not.toContainText("Our HVAC Services");
    await preview.close();
    expect(await (await page.request.get(`/sites/${workerTenant.platformSlug}`, { headers: { cookie: "" } })).text()).toContain("Our HVAC Services");

    await inspector(page).getByRole("switch", { name: "Show Services section" }).click();
    await expect(canvas(page)).toContainText("Our HVAC Services");
    await expect(canvas(page).getByText("Hidden · Services")).toHaveCount(0);
  });

  test("a section's style can change: the text both styles have is kept, and what would be lost is named first", async ({ page }) => {
    await openBuilder(page);
    await sectionPick(page, "services").click();
    const style = inspector(page).getByLabel("Style");
    await expect(style).toHaveValue("cards");
    await style.selectOption({ label: "Service catalog" });
    const dialog = page.getByRole("dialog", { name: "Change to Service catalog?" });
    await expect(dialog).toContainText("Heading");
    await expect(dialog).toContainText("Supporting text");
    await dialog.getByRole("button", { name: "Keep the current style" }).click();
    await expect(style).toHaveValue("cards");
    await expect(statusBadge(page)).toHaveText("Published");

    await style.selectOption({ label: "Service catalog" });
    await page.getByRole("dialog", { name: "Change to Service catalog?" }).getByRole("button", { name: "Change style" }).click();
    await expect(style).toHaveValue("catalog");
    await expect(inspector(page).getByLabel("Heading", { exact: true })).toHaveCount(0);
    await expect(canvas(page)).not.toContainText("Our HVAC Services");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(style).toHaveValue("cards");
    await expect(inspector(page).getByLabel("Heading", { exact: true })).toHaveValue("Our HVAC Services");

    // Where nothing is lost there is nothing to ask: icons -> plain keeps the heading and the points, and adds an introduction.
    await sectionPick(page, "why").click();
    const heading = await inspector(page).getByLabel("Heading", { exact: true }).inputValue();
    await inspector(page).getByLabel("Style").selectOption({ label: "Three points" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(inspector(page).getByLabel("Heading", { exact: true })).toHaveValue(heading);
    await expect(inspector(page).getByLabel("Supporting text", { exact: true })).toBeVisible();
  });

  test("sections move by keyboard from a menu: the list and the page change together, Discard puts them back and Save keeps the order", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await chooseAction(page, "Actions for Hero section", "Move down");
    await expect(page.getByRole("button", { name: "Actions for Hero section" })).toBeFocused();
    await chooseAction(page, "Actions for Hero section", "Move down");
    expect(await sectionOrder(page)).toEqual(["services", "why", "hero", "hours", "contact", "bookingCta"]);
    expect(await canvasOrder(page)).toEqual(["services", "why", "hero", "hours", "contact", "bookingCta"]);
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    expect(await storedSectionKeys(db, org, "draft", "home")).toEqual(HOME);

    await discardButton(page).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    expect(await sectionOrder(page)).toEqual(HOME);
    expect(await canvasOrder(page)).toEqual(HOME);

    await chooseAction(page, "Actions for Business hours section", "Move up");
    await sectionPick(page, "bookingCta").click();
    await page.getByRole("toolbar", { name: "Section actions" }).getByRole("button", { name: "Move up" }).click();
    const order = ["hero", "services", "hours", "why", "bookingCta", "contact"];
    expect(await sectionOrder(page)).toEqual(order);
    await saveDraft(page);
    expect(await storedSectionKeys(db, org, "draft", "home")).toEqual(order);
    expect(await storedSectionKeys(db, org, "live", "home")).toEqual(HOME);
    await page.reload();
    expect(await sectionOrder(page)).toEqual(order);
    expect(await canvasOrder(page)).toEqual(order);
  });

  test("sections can be dragged by their handle, and the same reordering works from the keyboard with spoken feedback", async ({ page, db, workerTenant }) => {
    // Tall enough for the whole list: a drag that nears the edge of a scrolling panel scrolls it, which would move the targets under the pointer.
    await page.setViewportSize({ width: 1440, height: 1500 });
    await openBuilder(page);
    const handle = page.getByRole("button", { name: "Reorder Hero section" });
    const from = (await handle.boundingBox())!;
    const target = (await sectionRow(page, "why").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 + 6, { steps: 16 });
    await page.mouse.up();
    expect(await sectionOrder(page)).toEqual(["services", "why", "hero", "hours", "contact", "bookingCta"]);
    expect(await canvasOrder(page)).toEqual(["services", "why", "hero", "hours", "contact", "bookingCta"]);
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("dropped at position 3 of 6");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    expect(await storedSectionKeys(db, workerTenant.organizationId, "draft", "home")).toEqual(HOME);

    // Keyboard: Space to pick up, arrows to move, Space to drop, Escape to cancel.
    const bookingHandle = page.getByRole("button", { name: "Reorder Booking CTA section" });
    await bookingHandle.focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("Picked up the Booking CTA section");
    // The library starts listening for the arrow keys a moment after the pick-up.
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("Booking CTA section is over position 5 of 6");
    await page.keyboard.press("Space");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("Booking CTA section was dropped at position 5 of 6");
    expect(await sectionOrder(page)).toEqual(["services", "why", "hero", "hours", "bookingCta", "contact"]);
    await page.getByRole("button", { name: "Reorder Contact section" }).focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("Picked up the Contact section");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("Contact section is over position 5 of 6");
    await page.keyboard.press("Escape");
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText("Reordering cancelled");
    expect(await sectionOrder(page)).toEqual(["services", "why", "hero", "hours", "bookingCta", "contact"]);
    await expect(handle).toHaveAccessibleDescription(/press Space on the handle/i);
  });

  test("a page of thirty sections stays usable: it lists and draws them all, moves the last to the first, and stores the order", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const site = (await db.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [org])).rows[0].id;
    await withTenant({ userId: workerTenant.userId, organizationId: org }, (tx) =>
      editDraft({ tx, organizationId: org }, site, (content) => {
        let next = content;
        for (let index = 0; index < 24; index += 1) {
          const change = addSection(next, "home", "feature_list", "plain");
          if (!change.ok) throw new Error(change.error);
          next = change.content;
        }
        return next;
      }),
    );
    await openBuilder(page);
    expect((await sectionOrder(page)).length).toBe(30);
    expect((await canvasOrder(page)).length).toBe(30);
    await sectionPick(page, "feature_list-24").click();
    const toolbar = canvas(page).getByRole("toolbar", { name: "Section actions" });
    const startedAt = Date.now();
    for (let step = 0; step < 29; step += 1) await toolbar.getByRole("button", { name: "Move up" }).click();
    expect(Date.now() - startedAt, "29 moves on a 30-section page").toBeLessThan(20_000);
    expect((await sectionOrder(page))[0]).toBe("feature_list-24");
    expect((await canvasOrder(page))[0]).toBe("feature_list-24");
    await expect(canvasPick(page, "Three points")).toHaveCount(24);
    await saveDraft(page);
    expect((await storedSectionKeys(db, org, "draft", "home"))[0]).toBe("feature_list-24");
    expect((await storedSectionKeys(db, org, "draft", "home")).length).toBe(30);
  });
});
