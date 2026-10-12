/**
 * Phase 16: what keeps the Website Builder from losing, overwriting or leaking anything, in the browser. A tab that is behind can never
 * overwrite a newer Draft or publish a state it was not showing; leaving with unsaved work (a link, the business switcher, logging out,
 * closing the tab) asks first; the canvas is a picture that cannot navigate, book or send; a visitor and another business reach none of it;
 * a failed save loses nothing; and the whole Builder works from the keyboard and meets the workspace's accessibility standard.
 */
import type { Page } from "playwright/test";
import { STALE_DRAFT } from "../src/lib/site-builder-rules";
import { editDraft, withHeadline } from "./draft-edits";
import { withTenant } from "../src/db/tenant";
import { UNREACHABLE } from "../src/lib/send-action";
import { expect, expectAccessible, test, waitsForHydration } from "./saas";
import {
  canvas,
  canvasPick,
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
  statusBadge,
  storedHeadline,
  storedSection,
  toasts,
} from "./website-builder-ui";

const LIVE_HEADLINE = "Heating & cooling service when you need it.";

/** A second tab of the same signed-in person, with the Builder open on the same website. */
async function secondTab(page: Page): Promise<Page> {
  const other = waitsForHydration(await page.context().newPage());
  await openBuilder(other);
  return other;
}

const staleBanner = (page: Page) => page.getByRole("alert").filter({ hasText: STALE_DRAFT });

test.describe("a tab that is behind", () => {
  test("it cannot overwrite what another tab saved: the save is refused whole, its work stays on screen, and Reload brings it up to date", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    const behind = await secondTab(page);

    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("From the first tab");
    await saveDraft(page);

    await sectionPick(behind, "hero").click();
    await headlineField(behind).fill("From the second tab");
    await behind.getByRole("button", { name: "Add section" }).click();
    await behind.getByRole("dialog", { name: "Add a section" }).getByRole("button", { name: /^Call to action/ }).click();
    await saveButton(behind).click();
    await expect(staleBanner(behind)).toBeVisible();
    await expect(toasts(behind)).toContainText(STALE_DRAFT);
    // Nothing of the second tab was stored, and the first tab's save is intact.
    expect(await storedHeadline(db, org, "draft")).toBe("From the first tab");
    expect((await db.query("select count(*)::int as n from site_sections s join site_pages p on p.id = s.page_id join site_versions v on v.id = p.site_version_id join sites st on st.id = v.site_id where st.organization_id = $1 and st.slug = 'main' and v.status = 'draft' and p.page_key = 'home'", [org])).rows[0].n).toBe(6);
    // The work is not thrown away: it is still there to copy, but it cannot be saved or published from here.
    await sectionPick(behind, "hero").click();
    await expect(headlineField(behind)).toHaveValue("From the second tab");
    expect(await sectionOrder(behind)).toContain("call_to_action-1");
    await expect(statusBadge(behind)).toHaveText("Unsaved changes");
    await expect(saveButton(behind)).toBeDisabled();
    await expect(publishButton(behind)).toBeDisabled();

    await behind.getByRole("button", { name: "Reload latest version" }).click();
    await expect(staleBanner(behind)).toHaveCount(0);
    await sectionPick(behind, "hero").click();
    await expect(headlineField(behind)).toHaveValue("From the first tab");
    await expect(statusBadge(behind)).toHaveText("Draft newer than published");
    // Up to date, it saves again.
    await headlineField(behind).fill("From the second tab, after reloading");
    await saveDraft(behind);
    expect(await storedHeadline(db, org, "draft")).toBe("From the second tab, after reloading");
  });

  test("a tab that is behind cannot publish either: the Draft it was showing is not the stored one, so nothing is published", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const site = (await db.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [org])).rows[0].id;
    // A saved Draft that is newer than the published site, so Publish is on in both tabs.
    await withTenant({ userId: workerTenant.userId, organizationId: org }, (tx) => editDraft({ tx, organizationId: org }, site, (content) => withHeadline(content, "Waiting to be published")));
    await openBuilder(page);
    const behind = await secondTab(page);
    await expect(publishButton(behind)).toBeEnabled();
    const published = async () => (await db.query<{ n: number }>("select count(*)::int as n from site_versions v where v.site_id = $1 and v.status = 'published'", [site])).rows[0].n;
    const count = await published();

    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Changed after the other tab opened");
    await saveDraft(page);

    await publishButton(behind).click();
    await expect(staleBanner(behind)).toBeVisible();
    expect(await published()).toBe(count);
    expect(await storedHeadline(db, org, "live")).toBe(LIVE_HEADLINE);
    await expect(publishButton(behind)).toBeDisabled();
    // The tab that is current publishes what it showed.
    await publishButton(page).click();
    await expect(toasts(page)).toContainText("Website published.");
    expect(await storedHeadline(db, org, "live")).toBe("Changed after the other tab opened");
  });

  test("a change made some other way (another route to the Draft) also makes an open Builder behind, and it says so on Save", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    await db.query(
      `update site_sections s set props = s.props || '{"headline":"Changed elsewhere"}'::jsonb
         from site_pages p, site_versions v, sites st
        where p.id = s.page_id and v.id = p.site_version_id and st.id = v.site_id and st.organization_id = $1 and st.slug = 'main' and v.status = 'draft' and p.page_key = 'home' and s.section_key = 'hero'`,
      [org],
    );
    await canvasPick(page, "Hero").click();
    await page.getByLabel("Section name").fill("Renamed in a stale tab");
    await saveButton(page).click();
    await expect(staleBanner(page)).toBeVisible();
    expect(await storedHeadline(db, org, "draft")).toBe("Changed elsewhere");
    expect((await storedSection(db, org, "draft", "home", "hero")).label).toBe("Hero");
  });

  test("a save that does not reach the server loses nothing: the work stays, it says so, and the next Save works", async ({ page, db, workerTenant, consoleGuard }) => {
    // The browser itself reports the refused connection.
    consoleGuard.allow(/Failed to load resource|net::ERR|Failed to fetch|fetch failed/i);
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Saved after the network came back");
    await page.route("**/website/builder**", (route) => (route.request().headers()["next-action"] ? route.abort("connectionrefused") : route.continue()));
    await saveButton(page).click();
    await expect(toasts(page)).toContainText(UNREACHABLE);
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    await expect(saveButton(page)).toBeEnabled();
    await expect(headlineField(page)).toHaveValue("Saved after the network came back");
    expect(await storedHeadline(db, workerTenant.organizationId, "draft")).toBe(LIVE_HEADLINE);
    await page.unroute("**/website/builder**");
    await saveDraft(page);
    expect(await storedHeadline(db, workerTenant.organizationId, "draft")).toBe("Saved after the network came back");
  });
});

test.describe("leaving with unsaved work", () => {
  test("a link out of the Builder asks first; Keep editing stays with everything as it was, Discard goes and nothing was saved", async ({ page, db, workerTenant }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Never saved");
    const bookings = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Bookings/ });

    await bookings.click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toContainText("You have unsaved changes. If you leave now, your changes to this website will be lost.");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/website\/builder\?page=home$/);
    await expect(headlineField(page)).toHaveValue("Never saved");
    await expect(statusBadge(page)).toHaveText("Unsaved changes");

    await page.getByRole("link", { name: "Back to Website" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/website\/builder/);

    await bookings.click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL("/bookings");
    expect(await storedHeadline(db, workerTenant.organizationId, "draft")).toBe(LIVE_HEADLINE);
    await openBuilder(page);
    await expect(canvas(page)).toContainText(LIVE_HEADLINE);
    await expect(canvas(page)).not.toContainText("Never saved");
  });

  test("moving around inside the Builder never asks: pages, sections, the theme and the preview sizes keep unsaved work as it is", async ({ page }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Kept while moving around");
    await pageItem(page, "about").click();
    await sectionPick(page, "intro").click();
    await page.getByRole("button", { name: "Site theme" }).click();
    await page.getByRole("group", { name: "Preview size" }).getByRole("button", { name: "Mobile" }).click();
    await pageItem(page, "home").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(statusBadge(page)).toHaveText("Unsaved changes");
    await expect(canvas(page)).toContainText("Kept while moving around");
  });

  test("with unsaved work the tab asks before it closes or reloads (the browser's own prompt), and with nothing unsaved it does not", async ({ context }) => {
    const tab = waitsForHydration(await context.newPage());
    await openBuilder(tab);
    // The browser asks when the page cancels the unload event; a person who has not edited anything is never asked.
    const asks = () => tab.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    await expect.poll(asks).toBe(false);
    await canvasPick(tab, "Hero").click();
    await headlineField(tab).fill("Unsaved in a closing tab");
    await expect.poll(asks).toBe(true);
    await headlineField(tab).fill(LIVE_HEADLINE);
    await expect.poll(asks).toBe(false);
    await headlineField(tab).fill("Unsaved again");
    await expect.poll(asks).toBe(true);
    await saveButton(tab).click();
    await expect(saveButton(tab)).toBeDisabled();
    await expect.poll(asks).toBe(false);
    await tab.close();
  });

  test("switching to another business or logging out with unsaved work asks first, and nothing of this business is carried to the next", async ({ openAs, db }) => {
    const casey = await openAs("casey");
    const view = casey.page;
    await openBuilder(view);
    const switcher = view.getByTitle("Switch workspace");
    const here = (await switcher.innerText()).trim();
    await canvasPick(view, "Hero").click();
    const typed = "Unsaved in the first business";
    await headlineField(view).fill(typed);

    // The business switcher asks, and Keep editing leaves everything where it was.
    const workspaces = view.getByRole("region", { name: "Workspaces" });
    const openSwitcher = async () => {
      if (!(await workspaces.isVisible())) await switcher.click();
    };
    await openSwitcher();
    const other = workspaces.locator('button:not([aria-current="true"])').first();
    const otherName = (await other.innerText()).split("\n")[0].trim();
    expect(otherName).not.toBe(here);
    await other.click();
    await view.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Keep editing" }).click();
    await expect(headlineField(view)).toHaveValue(typed);
    await expect(switcher).toContainText(here);

    // Log out asks too.
    await view.getByRole("banner").getByRole("button", { name: /,/ }).click();
    await view.getByRole("button", { name: "Log out" }).click();
    const logout = view.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(logout).toContainText("If you log out now");
    await logout.getByRole("button", { name: "Keep editing" }).click();
    await expect(view).toHaveURL(/\/website\/builder/);

    // Discarding and switching: the other business opens as itself, with none of what was typed.
    await openSwitcher();
    await workspaces.locator('button:not([aria-current="true"])').first().click();
    await view.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(switcher).toContainText(otherName);
    await openBuilder(view);
    await expect(view.locator("body")).not.toContainText(typed);
    // Nothing was ever stored for either business.
    const stored = (await db.query<{ n: number }>("select count(*)::int as n from site_sections where props->>'headline' = $1", [typed])).rows[0].n;
    expect(stored).toBe(0);
    expect(casey.problems).toEqual([]);
  });
});

test.describe("the canvas is a picture", () => {
  test("nothing in it can be clicked through, focused or sent: its links and buttons are inert, and the Builder's own marks are the only controls over it", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await openBuilder(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    const before = (await db.query<{ n: number }>("select count(*)::int as n from bookings where organization_id = $1", [org])).rows[0].n;

    // Every control in the canvas is in an inert wrapper, except the Builder's own selection marks and toolbar.
    const outside = await canvas(page).evaluate((root) =>
      [...root.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")]
        .filter((element) => !element.closest("[inert]"))
        .filter((element) => !(element.getAttribute("aria-label") ?? "").startsWith("Select ") && !element.closest('[role="toolbar"]'))
        .map((element) => element.outerHTML.slice(0, 80)),
    );
    expect(outside).toEqual([]);

    // Clicking where a link, a Book button or a service card is selects the section; it goes nowhere and books nothing.
    for (const text of ["Book service", "View services", "Book a time", "Request appointment"]) {
      await canvas(page).getByText(text).first().click({ force: true });
      await expect(page).toHaveURL(/\/website\/builder\?page=home$/);
    }
    await expect(inspector(page)).toHaveAttribute("data-selection", "section");
    // Tabbing through the whole page never lands inside the picture.
    await page.getByRole("heading", { level: 1, name: "Website Builder" }).click();
    for (let step = 0; step < 90; step += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("[inert]") != null)).toBe(false);
    }
    expect((await db.query<{ n: number }>("select count(*)::int as n from bookings where organization_id = $1", [org])).rows[0].n).toBe(before);
    expect(requests).toEqual([]);
  });

  test("the Contact form in the canvas sends nothing, and the Booking page's choices create no booking", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    const count = async () => (await db.query<{ n: number }>("select (select count(*) from bookings where organization_id = $1)::int + (select count(*) from customers where organization_id = $1)::int as n", [org])).rows[0].n;
    const before = await count();
    await openBuilder(page, "contact");
    await canvas(page).locator("form").first().evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await canvasPick(page, "Contact form").click();
    await expect(inspector(page)).toContainText("Messages sent from this form are not delivered yet");
    await openBuilder(page, "booking");
    for (const text of ["Request appointment", "Book a time", "Request a quote"]) await canvas(page).getByText(text).first().click({ force: true });
    expect(await count()).toBe(before);
    expect(requests).toEqual([]);
  });

  test("the Builder's marks never reach the website: not the signed-in Draft preview and not the published pages", async ({ page, workerTenant }) => {
    await openBuilder(page);
    for (const path of ["/website/preview", `/sites/${workerTenant.platformSlug}`, `/sites/${workerTenant.platformSlug}/services`]) {
      const html = await (await page.request.get(path)).text();
      for (const mark of ["builder-canvas", "canvas-frame", "builder-section-", "Section actions", "Select Hero section", "Website Builder", "data-builder-section"]) expect(html, `${path} ${mark}`).not.toContain(mark);
    }
  });
});

test.describe("who can reach the Builder", () => {
  test("a visitor is sent to log in and sees nothing of it; a visitor's page of the public site has no way in", async ({ apiAs, workerTenant }) => {
    const visitor = await apiAs(null);
    for (const path of ["/website/builder", "/website/builder?page=home", "/website/pages/home"]) {
      const response = await visitor.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers().location, path).toContain("/login");
      expect(await response.text(), path).not.toContain("Website Builder");
    }
    for (const path of [`/sites/${workerTenant.platformSlug}/website/builder`, `/sites/${workerTenant.platformSlug}/builder`]) {
      const response = await visitor.get(path);
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).not.toContain("builder-canvas");
    }
  });

  test("the page asked for is looked up in this business's own Draft: odd or foreign page names are not found and never echoed", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    for (const key of ["<script>alert(1)</script>", "..%2F..%2Fsettings", "HOME", "northstar-home", "x".repeat(300)]) {
      const response = await page.goto(`/website/builder?page=${key}`);
      expect(response?.status(), key).toBe(404);
      await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
      expect(await page.content()).not.toContain("<script>alert(1)</script>");
    }
  });

  test("a Draft saved and not published is never public, whatever is asked for", async ({ page, apiAs, workerTenant }) => {
    await openBuilder(page);
    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("Draft only, not public");
    await saveDraft(page);
    const visitor = await apiAs(null);
    for (const path of [`/sites/${workerTenant.platformSlug}`, `/sites/${workerTenant.platformSlug}?draft=1`, `/sites/${workerTenant.platformSlug}/preview`]) {
      const response = await visitor.get(path);
      expect(await response.text(), path).not.toContain("Draft only, not public");
    }
    const preview = await visitor.get("/website/preview", { maxRedirects: 0 });
    expect(preview.status()).toBe(307);
    expect(await preview.text()).not.toContain("Draft only, not public");
  });
});

test.describe("the keyboard and assistive technology", () => {
  test("the Builder meets the workspace's accessibility standard in each of its states", async ({ page }) => {
    await openBuilder(page);
    await expectAccessible(page);
    await canvasPick(page, "Hero").click();
    await expectAccessible(page);
    await pageItem(page, "about").click();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Site theme" }).click();
    await expectAccessible(page);
    await page.getByLabel("Accent colour code").fill("#12");
    await expectAccessible(page);
    await page.getByLabel("Accent colour code").fill("#8B3A1E");
    // With the Add section dialog open, and with an actions menu open.
    await page.getByRole("button", { name: "Add section" }).click();
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Actions for About page" }).click();
    await expectAccessible(page);
  });

  test("a member who may only look gets the same standard", async ({ openAs }) => {
    const jamie = await openAs("jamie");
    await openBuilder(jamie.page);
    await expectAccessible(jamie.page);
    await canvasPick(jamie.page, "Hero").click();
    await expectAccessible(jamie.page);
    expect(jamie.problems).toEqual([]);
  });

  test("every control can be reached by Tab, has a name, and shows where the focus is", async ({ page }) => {
    const walk = async (steps: number): Promise<{ names: Set<string>; outlined: number }> => {
      const names = new Set<string>();
      let outlined = 0;
      for (let step = 0; step < steps; step += 1) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return null;
          const style = getComputedStyle(element);
          const labelled = element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() : "";
          const name = element.getAttribute("aria-label") || labelled || element.closest("label")?.textContent?.trim() || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) || "";
          const ring = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none" || element.matches("input, select, textarea");
          return { name, ring };
        });
        if (!focus) continue;
        expect(focus.name, "a focused control has a name").not.toBe("");
        if (focus.ring) outlined += 1;
        names.add(focus.name);
      }
      return { names, outlined };
    };
    const reaches = (names: Set<string>, expected: string[]) => {
      for (const name of expected) expect([...names].some((entry) => entry === name || entry.startsWith(name)), `Tab reaches "${name}"`).toBe(true);
    };

    // From the top of the page: the bar, the page list, the section list, the marks over the page and the page's inspector.
    await openBuilder(page);
    const first = await walk(150);
    reaches(first.names, ["Back to Website", "Desktop", "Tablet", "Mobile", "Add page", "Actions for Home page", "Site theme", "Add section", "Reorder Hero section", "Actions for Hero section", "Select Hero section", "Page title", "Duplicate"]);
    expect(first.outlined).toBeGreaterThan(40);

    // From a section on the page: its toolbar and its inspector, field by field.
    await canvasPick(page, "Hero").click();
    const second = await walk(30);
    reaches(second.names, ["Move up", "Move down", "Duplicate", "Hide section", "Delete section", "Section name", "Headline", "Supporting text", "Primary button label", "Secondary button label", "Left"]);
  });

  test("an actions menu is a real menu: opened from the keyboard, arrow keys move, Enter does it, Escape closes, and focus comes back", async ({ page }) => {
    await openBuilder(page);
    const trigger = page.getByRole("button", { name: "Actions for Hero section" });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Actions for Hero section" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: /Move down/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await sectionOrder(page)).toEqual(["services", "hero", "why", "hours", "contact", "bookingCta"]);
    await expect(page.getByRole("button", { name: "Actions for Hero section" })).toBeFocused();
    await openMenu(page, "Actions for Hero section");
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: /Delete section/ })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("menuitem", { name: /Move up/ })).toBeFocused();
  });

  test("dialogs keep the focus inside, close on Escape, and give it back to what opened them", async ({ page }) => {
    await openBuilder(page);
    const opener = page.getByRole("button", { name: "Add section" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Add a section" });
    await expect(dialog).toBeVisible();
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog[open]") != null || document.activeElement === document.body), `Tab ${step}`).toBe(true);
    }
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog[open]") != null || document.activeElement === document.body), `Shift+Tab ${step}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();

    await canvasPick(page, "Hero").click();
    await headlineField(page).fill("x");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeFocused();
  });

  test("reordering has a keyboard alternative to dragging everywhere a section is acted on, and a spoken description of how to drag", async ({ page }) => {
    await openBuilder(page);
    // The same Move up / Move down on a section's menu, on the toolbar over it and in the inspector.
    await canvasPick(page, "Services").click();
    for (const where of [canvas(page).getByRole("toolbar", { name: "Section actions" }), inspector(page)]) {
      await expect(where.getByRole("button", { name: "Move up" })).toBeVisible();
      await expect(where.getByRole("button", { name: "Move down" })).toBeVisible();
    }
    const menu = await openMenu(page, "Actions for Services section");
    await expect(menu.getByRole("menuitem", { name: "Move up" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Move down" })).toBeVisible();
    await page.keyboard.press("Escape");
    const handle = page.getByRole("button", { name: "Reorder Services section" });
    await expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    await expect(handle).toHaveAccessibleDescription(/Space.*arrow keys.*Escape cancels.*Move up and Move down/i);
    // Hiding is a keyboard control too, and says so in its name.
    await expect(inspector(page).getByRole("switch", { name: "Show Services section" })).toBeVisible();
  });

  test("a screen reader hears where it is: the current page and section are marked, the status is announced, the canvas marks are named", async ({ page }) => {
    await openBuilder(page);
    await expect(pageItem(page, "home")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Website Builder");
    for (const name of ["Pages", "Sections"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(page.getByRole("group", { name: "Preview size" })).toBeVisible();
    await expect(page.getByRole("group", { name: "History" })).toBeVisible();
    await canvasPick(page, "Hero").click();
    await expect(canvasPick(page, "Hero")).toHaveAttribute("aria-pressed", "true");
    await headlineField(page).fill("Announced");
    await saveDraft(page);
    await expect(toasts(page)).toContainText("Draft saved.");
    await expect(page.getByRole("link", { name: "Preview" })).toHaveAttribute("target", "_blank");
  });
});
