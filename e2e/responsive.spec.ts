/**
 * Phase 8, Part G. The workspace is held together at the five audited sizes: the top bar is one row with nothing on
 * top of anything else, no page scrolls sideways (wide tables scroll inside themselves), dialogs stay inside the
 * window, and the customer-facing pages hold up on a phone. Desktop geometry is pinned so a responsive fix cannot
 * drift it.
 */
import type { Locator, Page } from "playwright/test";
import { expect, test } from "./fixtures";
import { DIALOGS } from "./dialogs";
import { ROUTE_INVENTORY, STATE_ROUTES } from "./route-inventory";

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 800, height: 900 },
  { width: 768, height: 1024 },
] as const;

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const rectOf = async (locator: Locator): Promise<Rect> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, width: box.width, height: box.height };
};

/** Overflow the page itself has, plus anything in the main area that sticks out without a scrolling or clipping box around it. */
async function overflowOf(page: Page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const main = document.querySelector("main");
    const limit = (main ? main.getBoundingClientRect().right : viewport) + 1;
    const contained = (element: Element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) return true;
        if (style.position === "fixed") return true;
      }
      return false;
    };
    const stray = [...document.querySelectorAll(main ? "main *" : "body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > limit && !contained(element) && getComputedStyle(element).position !== "fixed";
      })
      .slice(0, 3)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.getAttribute("class") ?? "").slice(0, 60)}`);
    return { page: document.documentElement.scrollWidth - viewport, stray };
  });
}

test.describe("the top bar at each audited size", () => {
  for (const size of SIZES) {
    test(`${size.width}×${size.height}: one row, nothing overlapping or cut off, search still usable`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      const header = page.getByRole("banner");
      const bar = await rectOf(header);
      expect(bar.height).toBeCloseTo(64, 0);
      expect(bar.width).toBeCloseTo(size.width, 0);

      // Left to right, as the eye reads them.
      const parts: [string, Locator][] = [
        ["logo", header.locator("a[href='/']").first()],
        ["workspace", header.getByRole("button", { name: /Apex Climate Heating & Air/ })],
        ["search", header.getByPlaceholder("Search customers, jobs, bookings, schedule...")],
        ["notifications", header.getByRole("button", { name: /Notifications/ })],
        ["user", header.getByRole("button", { name: "Alex Morgan, Operations Lead" })],
      ];
      const rects: [string, Rect][] = [];
      for (const [name, locator] of parts) {
        await expect(locator, name).toBeVisible();
        rects.push([name, await rectOf(locator)]);
      }
      for (const [name, rect] of rects) {
        expect(rect.left, `${name} left`).toBeGreaterThanOrEqual(0);
        expect(rect.right, `${name} right`).toBeLessThanOrEqual(size.width);
        expect(rect.top, `${name} top`).toBeGreaterThanOrEqual(0);
        expect(rect.bottom, `${name} bottom`).toBeLessThanOrEqual(bar.height);
      }
      for (let index = 1; index < rects.length; index++) {
        const [leftName, left] = rects[index - 1];
        const [rightName, right] = rects[index];
        expect(left.right, `${leftName} must end before ${rightName} starts`).toBeLessThanOrEqual(right.left);
      }
      const search = rects.find(([name]) => name === "search")![1];
      expect(search.width, "search width").toBeGreaterThanOrEqual(200);

      // The name beside the avatar is a wide-screen luxury; the link keeps its accessible name either way.
      const name = header.getByText("Alex Morgan", { exact: true });
      if (size.width >= 1024) await expect(name).toBeVisible();
      else await expect(name).toBeHidden();

      expect((await overflowOf(page)).page).toBeLessThanOrEqual(0);
    });
  }

  test("1440 and 1280 keep the approved desktop geometry exactly", async ({ page }) => {
    for (const size of [SIZES[0], SIZES[1]]) {
      await page.setViewportSize(size);
      await page.goto("/");
      const header = page.getByRole("banner");
      const logo = await rectOf(header.locator("a[href='/']").first());
      const workspace = await rectOf(header.getByRole("button", { name: /Apex Climate Heating & Air/ }));
      const user = await rectOf(header.getByRole("button", { name: "Alex Morgan, Operations Lead" }));
      expect(logo.left).toBeCloseTo(24, 0);
      expect(workspace.left).toBeCloseTo(152, 0);
      expect(workspace.width).toBeCloseTo(260, 0);
      expect(user.right).toBeCloseTo(size.width - 24, 0);
      const sidebar = await rectOf(page.getByRole("navigation", { name: "Primary" }));
      expect(sidebar.width).toBeCloseTo(240, 0);
      expect(sidebar.top).toBeCloseTo(64, 0);
      const main = await rectOf(page.locator("main"));
      expect(main.left).toBeCloseTo(240, 0);
    }
  });

  test("the sidebar's pinned Settings and Help stay on screen at every audited height", async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto("/");
      for (const name of ["Settings", "Help"]) {
        const link = await rectOf(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name }));
        expect(link.bottom, `${name} at ${size.height}`).toBeLessThanOrEqual(size.height);
      }
    }
  });

  test("the notifications panel opens inside the window at the narrowest size", async ({ page }) => {
    await page.setViewportSize(SIZES[4]);
    await page.goto("/");
    await page.getByRole("button", { name: /Notifications/ }).click();
    const panel = await rectOf(page.getByRole("region", { name: "Notifications" }));
    expect(panel.left).toBeGreaterThanOrEqual(0);
    expect(panel.right).toBeLessThanOrEqual(768);
  });
});

test.describe("no page scrolls sideways", () => {
  const WORKSPACE_URLS = [...ROUTE_INVENTORY.filter((route) => route.shell).map((route) => route.url), ...STATE_ROUTES];

  for (const size of SIZES) {
    test(`${size.width}×${size.height}: every workspace route and state`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize(size);
      const problems: string[] = [];
      for (const url of WORKSPACE_URLS) {
        await page.goto(url);
        await page.locator("main").waitFor();
        await page.waitForLoadState("networkidle");
        const overflow = await overflowOf(page);
        if (overflow.page > 0 || overflow.stray.length) problems.push(`${url} ${JSON.stringify(overflow)}`);
      }
      expect(problems).toEqual([]);
    });
  }

  test("wide tables scroll inside their own box rather than pushing the page", async ({ page }) => {
    await page.setViewportSize(SIZES[4]);
    for (const url of ["/bookings", "/jobs", "/customers", "/payments", "/quotes-invoices"]) {
      await page.goto(url);
      const table = page.locator("main table").first();
      await expect(table, url).toBeVisible();
      const wrapper = table.locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]");
      await expect(wrapper, url).toHaveCount(1);
      expect((await overflowOf(page)).page, url).toBeLessThanOrEqual(0);
    }
  });

  test("the day schedule keeps its three columns off the page edge at 1024", async ({ page }) => {
    await page.setViewportSize(SIZES[2]);
    await page.goto("/schedule?view=day");
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    expect((await overflowOf(page)).page).toBeLessThanOrEqual(0);
    const main = await rectOf(page.locator("main"));
    expect(main.right).toBeLessThanOrEqual(1024);
  });
});

test.describe("dialogs stay inside the window", () => {

  for (const size of [SIZES[2], SIZES[3], SIZES[4]]) {
    test(`${size.width}×${size.height}: each dialog fits, and its actions can be reached`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      for (const opener of DIALOGS) {
        await page.goto(opener.url);
        await opener.open(page);
        const dialog = page.getByRole("dialog", { name: opener.title });
        await expect(dialog, opener.name).toBeVisible();
        const box = await rectOf(dialog);
        expect(box.left, `${opener.name} left`).toBeGreaterThanOrEqual(0);
        expect(box.top, `${opener.name} top`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${opener.name} right`).toBeLessThanOrEqual(size.width);
        expect(box.bottom, `${opener.name} bottom`).toBeLessThanOrEqual(size.height);
        // Its buttons are inside it and inside the window, without scrolling the page.
        for (const button of await dialog.getByRole("button").all()) {
          if (!(await button.isVisible())) continue;
          const b = await rectOf(button);
          expect(b.right, `${opener.name} button right`).toBeLessThanOrEqual(size.width);
          expect(b.bottom, `${opener.name} button bottom`).toBeLessThanOrEqual(size.height);
        }
        await page.keyboard.press("Escape");
        await expect(dialog, opener.name).toBeHidden();
      }
    });
  }

  test("the unsaved-changes dialog fits at 768×1024", async ({ page }) => {
    await page.setViewportSize(SIZES[4]);
    await page.goto("/settings");
    await page.getByLabel("City").fill("Round Rock");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Help" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toBeVisible();
    const box = await rectOf(dialog);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(768);
    expect(box.bottom).toBeLessThanOrEqual(1024);
  });
});

test.describe("the customer-facing pages hold up on a phone", () => {
  const PUBLIC = ROUTE_INVENTORY.filter((route) => !route.shell).map((route) => route.url);

  test("there are public routes to check", () => {
    expect(PUBLIC.length).toBeGreaterThanOrEqual(7);
  });

  for (const size of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    test(`${size.width}px: no sideways scroll, one heading, content reachable`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      const problems: string[] = [];
      for (const url of PUBLIC) {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        const overflow = await overflowOf(page);
        if (overflow.page > 0) problems.push(`${url} ${JSON.stringify(overflow)}`);
        await expect(page.getByRole("heading", { level: 1 }), url).toHaveCount(1);
      }
      expect(problems).toEqual([]);
    });
  }
});
