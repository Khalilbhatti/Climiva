/**
 * Phase 17: each Template as a visitor gets it, and as a business edits it.
 *
 * For every Template, every standard page at Desktop, Tablet and Mobile width: one level-1 heading, the landmarks a page needs, no
 * horizontal overflow, controls with names, the workspace's contrast standard, a navigation that fits a phone and a keyboard that can reach
 * and see everything. And the Builder works on a Template exactly as it works on the starter: it is a starting composition, not a locked
 * layout (edit, add, copy, restyle, remove, add a page, change the theme and its design style, save, publish).
 *
 * The Template is put on the worker's own copy of the Apex business and published through the data layer (the screens do the same in
 * website-templates-ui.spec.ts), so these specs spend their time on the result.
 */
import type { Page } from "playwright/test";
import { findTemplateRecord } from "../src/db/site-templates";
import { SERVICES } from "./apex-data";
import { structuralIssues, unnamedControls } from "./a11y-lint";
import { findLowContrast } from "./contrast";
import { expect, test } from "./saas";
import { canvas, canvasPick, chooseAction, headlineField, inspector, openBuilder, pageOrder, publishButton, saveDraft, sectionOrder, statusBadge, toasts } from "./website-builder-ui";
import { publicHtml, stored, useTemplate } from "./website-templates-ui";

const TEMPLATES = [
  { key: "climvia-starter", look: null, name: "Climvia Starter" },
  { key: "precision", look: "precision", name: "Precision" },
  { key: "comfort", look: "comfort", name: "Comfort" },
  { key: "airflow", look: "airflow", name: "Airflow" },
] as const;

const PAGES = [
  { path: "", name: "Home" },
  { path: "/services", name: "Services" },
  { path: "/about", name: "About" },
  { path: "/contact", name: "Contact" },
  { path: "/booking", name: "Booking" },
];
const WIDTHS = [
  { id: "desktop", width: 1280, height: 900 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "mobile", width: 390, height: 844 },
] as const;

test.describe.configure({ timeout: 120_000 });

/** What is wrong with a drawn website page, in words; empty when nothing is. */
async function problemsOf(page: Page, width: number): Promise<string[]> {
  const problems: string[] = [];
  const count = async (selector: string) => page.locator(selector).count();
  if ((await count("h1")) !== 1) problems.push(`${await count("h1")} level-1 headings`);
  for (const [selector, label] of [["header", "banner"], ['nav[aria-label="Website"]', "navigation"], ["main", "main"], ["footer", "footer"]] as const) {
    if ((await count(selector)) !== 1) problems.push(`${await count(selector)} ${label} landmarks`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`scrolls sideways by ${overflow}px`);
  problems.push(...(await unnamedControls(page)).map((entry) => `control without a name: ${JSON.stringify(entry)}`));
  problems.push(...(await structuralIssues(page)).map((entry) => `structure: ${JSON.stringify(entry)}`));
  problems.push(...(await findLowContrast(page)).map((entry) => `low contrast ${entry.ratio.toFixed(2)} (need ${entry.need}): "${entry.text.slice(0, 40)}" ${entry.element}`));
  // The navigation fits the screen: every link is wholly inside it.
  const outside = await page.evaluate((viewport) => [...document.querySelectorAll('nav[aria-label="Website"] a')].filter((link) => {
    const box = link.getBoundingClientRect();
    return box.left < -1 || box.right > viewport + 1;
  }).map((link) => link.textContent?.trim()), width);
  if (outside.length > 0) problems.push(`navigation links outside the screen: ${outside.join(", ")}`);
  return problems;
}

test.describe("a visitor's view of each Template", () => {
  for (const template of TEMPLATES) {
    test(`${template.name}: every page at Desktop, Tablet and Mobile is one outline, fits its screen and meets the contrast standard`, async ({ page, db, workerTenant }) => {
      await useTemplate(db, workerTenant, template.key, { publish: true });
      const failures: string[] = [];
      for (const { id, width, height } of WIDTHS) {
        await page.setViewportSize({ width, height });
        for (const { path, name } of PAGES) {
          const response = await page.goto(`/sites/${workerTenant.platformSlug}${path}`);
          expect(response?.status(), `${template.key} ${name}`).toBe(200);
          await expect(page.getByTestId("site-frame")).toBeVisible();
          if (template.look) await expect(page.getByTestId("site-frame")).toHaveAttribute("data-site-look", template.look);
          else await expect(page.getByTestId("site-frame")).not.toHaveAttribute("data-site-look", /.+/);
          for (const problem of await problemsOf(page, width)) failures.push(`${template.key} · ${name} · ${id}: ${problem}`);
        }
      }
      expect(failures).toEqual([]);
    });

    test(`${template.name}: the booking journey of a Service, the signed-in Draft preview and the page a visitor reaches by its address are drawn in the same style`, async ({ page, db, workerTenant }) => {
      await useTemplate(db, workerTenant, template.key, { publish: false });
      const slug = SERVICES[0].id;
      // The Draft preview (signed in): the same renderer, the same style.
      await page.goto("/website/preview/services");
      if (template.look) await expect(page.getByTestId("site-frame")).toHaveAttribute("data-site-look", template.look);
      // Published (nothing new yet: the published website is still the starter's), then the Template published: the journey is drawn in it.
      await useTemplate(db, workerTenant, template.key, { publish: true });
      await page.goto(`/sites/${workerTenant.platformSlug}/booking/${slug}`);
      await expect(page.getByTestId("site-frame")).toBeVisible();
      if (template.look) await expect(page.getByTestId("site-frame")).toHaveAttribute("data-site-look", template.look);
      expect(await page.locator("h1, h2").count()).toBeGreaterThan(0);
      expect(await problemsOf(page, 1280).then((all) => all.filter((entry) => !/level-1 headings|banner|navigation|main|footer/.test(entry)))).toEqual([]);
    });

    test(`${template.name}: a keyboard reaches the navigation, every Service and the booking buttons, and always shows where it is`, async ({ page, db, workerTenant }) => {
      await useTemplate(db, workerTenant, template.key, { publish: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/sites/${workerTenant.platformSlug}/services`);
      // The first stops are the site's own header: the name, the pages, the booking button.
      const stops: string[] = [];
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          const style = getComputedStyle(element);
          return { text: element.textContent?.trim().slice(0, 30) ?? "", inHeader: Boolean(element.closest("header")), outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 };
        });
        stops.push(stop.text);
        expect(stop.outline, `${template.key}: "${stop.text}" shows where the keyboard is`).toBe(true);
      }
      expect(stops.some((text) => /Services|About|Contact/.test(text))).toBe(true);
      // Every shown Service has a real link to its booking journey, and focus can be put on it.
      const links = page.locator('main a[href*="/booking/"]');
      expect(await links.count()).toBe(SERVICES.filter((service) => service.visibility !== "internal" && service.active).length);
      for (let index = 0; index < (await links.count()); index += 1) {
        await links.nth(index).focus();
        await expect(links.nth(index)).toBeFocused();
      }
    });
  }
});

test.describe("a business edits a Template exactly as it edits anything", () => {
  for (const template of TEMPLATES) {
    test(`${template.name}: edit, add, copy, restyle and remove sections, add a page, change the theme and design style, undo, save and publish`, async ({ page, db, workerTenant }) => {
      const org = workerTenant.organizationId;
      await useTemplate(db, workerTenant, template.key, { publish: false });
      const definition = findTemplateRecord(template.key)!.definition;
      const home = definition.pages[0].sections.map((section) => section.key);

      await openBuilder(page);
      await expect(page.getByTestId("builder-template")).toContainText(`Based on: ${template.name}`);
      expect(await pageOrder(page)).toEqual(["home", "services", "about", "contact", "booking"]);
      expect(await sectionOrder(page)).toEqual(home);
      if (template.look) await expect(canvas(page).locator(`[data-site-look="${template.look}"]`).first()).toBeVisible();

      // Edit the opening's words.
      await canvasPick(page, definition.pages[0].sections[0].label).click();
      await headlineField(page).fill("Edited on a Template");
      await expect(canvas(page)).toContainText("Edited on a Template");

      // Add a section from the library: every kind of section is still offered, whatever Template the page began as.
      await page.getByRole("button", { name: "Add section" }).click();
      const library = page.getByRole("dialog", { name: "Add a section" });
      await expect(library.getByRole("button", { name: /^Contact card/ }).first()).toBeVisible();
      await expect(library.getByRole("button", { name: /^Trust strip/ })).toBeVisible();
      await library.getByRole("button", { name: /^Contact form/ }).click();
      expect((await sectionOrder(page)).length).toBe(home.length + 1);
      await expect(canvas(page)).toContainText("Send us a message");

      // Copy and remove it again; the new section is drawn in the Template's style (the style is the site's, not the section's).
      await chooseAction(page, "Actions for Contact form section", "Duplicate");
      expect((await sectionOrder(page)).length).toBe(home.length + 2);
      await inspector(page).getByRole("button", { name: "Delete section" }).click();
      expect((await sectionOrder(page)).length).toBe(home.length + 1);
      await page.getByRole("button", { name: "Undo" }).click();
      expect((await sectionOrder(page)).length).toBe(home.length + 2);

      // Switch a section to another style of the same kind: the editor says what changes, and the section is still valid.
      await canvasPick(page, "Contact form").first().click();
      await expect(inspector(page).getByLabel("Style")).toHaveCount(0);
      const closing = definition.pages[0].sections.at(-1)!;
      await canvasPick(page, closing.label).click();
      const style = inspector(page).getByLabel("Style");
      const options = await style.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
      const other = options.find((option) => option !== options[0] && !/^Call to action$/.test(option))!;
      await style.selectOption({ label: other });
      await expect(statusBadge(page)).toHaveText("Unsaved changes");

      // A new page.
      await page.getByRole("button", { name: "Add page" }).click();
      await page.getByLabel("Page title").fill("Spring offers");
      expect(await pageOrder(page)).toContain("page-1");

      // The theme: the design style is a choice like the corners and the spacing, and the canvas follows it at once.
      await page.getByRole("button", { name: "Site theme" }).click();
      const designStyle = inspector(page).getByLabel("Design style");
      await expect(designStyle).toHaveValue(template.look ?? "standard");
      await designStyle.selectOption("airflow");
      await expect(canvas(page).locator('[data-site-look="airflow"]').first()).toBeVisible();
      await designStyle.selectOption(template.look ?? "standard");
      await page.getByLabel("Accent colour code").fill("#8B3A1E");

      // Save: the Draft is what was edited, still based on the Template; the published website is not touched until Publish.
      await saveDraft(page);
      const draft = await stored(db, org, "draft");
      expect(draft.templateKey).toBe(template.key);
      expect(JSON.stringify(draft.pages)).toContain("Edited on a Template");
      expect(JSON.stringify(draft.pages)).toContain("Spring offers");
      expect((draft.theme as { accent: string }).accent).toBe("#8B3A1E");
      expect((draft.theme as { look?: string }).look).toBe(template.look ?? undefined);
      expect(await publicHtml(page, workerTenant.platformSlug)).not.toContain("Edited on a Template");

      await publishButton(page).click();
      await expect(toasts(page)).toContainText("Website published.");
      const live = await publicHtml(page, workerTenant.platformSlug);
      expect(live).toContain("Edited on a Template");
      // The new page is published at its own address (a rename does not move it) and is in the menu under its new title.
      expect(await publicHtml(page, workerTenant.platformSlug, "/new-page")).toContain("A short introduction to this page.");
      expect(live).toContain("Spring offers");
    });
  }
});
