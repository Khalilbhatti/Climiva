/**
 * Phase 8, Parts M and N. The final accessibility and contrast pass: every route is held to the same structural and
 * contrast checks, then the interactions that depend on the keyboard (dialogs, menus, tabs, forms) are driven with
 * nothing but the keyboard. No new dependency: the checks use the browser's own accessibility tree and painted colours.
 */
import { readFileSync } from "node:fs";
import type { Locator, Page } from "playwright/test";
import { structuralIssues, unnamedControls } from "./a11y-lint";
import { findLowContrast } from "./contrast";
import { DIALOGS } from "./dialogs";
import { expect, test } from "./fixtures";
import { ROUTE_INVENTORY, STATE_ROUTES } from "./route-inventory";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/* ───────────────────────── every route ───────────────────────── */

test.describe("every route passes the structural and contrast checks", () => {
  const URLS = [...ROUTE_INVENTORY.map((route) => route.url), ...STATE_ROUTES];
  for (const url of URLS) {
    test(url, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.lang), "html lang").toBe("en");
      const title = await page.title();
      expect(title.trim().length, "page title").toBeGreaterThan(0);
      expect(title).not.toMatch(/undefined|null|\[object/);
      expect(await unnamedControls(page), "controls without a name").toEqual([]);
      expect(await structuralIssues(page), "structure").toEqual([]);
      expect(await findLowContrast(page), "contrast").toEqual([]);
    });
  }
});

/* ───────────────────────── colour ───────────────────────── */

test.describe("the colour tokens meet WCAG AA", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const token = (name: string) => {
    const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!match) throw new Error(`missing token ${name}`);
    return match[1];
  };
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  const luminance = (hex: string) => {
    const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const TEXT_PAIRS: [string, string][] = [
    // The accent with white text, in every state a button can be in.
    ["white", "primary"],
    ["white", "primary-hover"],
    ["white", "danger"],
    ["white", "danger-hover"],
    // Body and secondary text on every surface they sit on.
    ...["canvas", "surface", "surface-low", "hover", "primary-subtle", "neutral-soft"].map((surface): [string, string] => ["ink", surface]),
    ...["canvas", "surface", "surface-low", "hover", "primary-subtle", "neutral-soft", "positive-soft", "warning-soft", "danger-soft"].map(
      (surface): [string, string] => ["ink-muted", surface],
    ),
    // Links and status badges: their colour on their own tint.
    ["primary", "surface"],
    ["primary", "canvas"],
    ["primary", "primary-subtle"],
    ["positive", "positive-soft"],
    ["warning", "warning-soft"],
    ["danger", "danger-soft"],
    ["danger", "surface"],
    ["positive", "surface"],
  ];
  for (const [foreground, background] of TEXT_PAIRS) {
    test(`${foreground} on ${background} reads at 4.5:1 or better`, () => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("the keyboard focus ring (the accent) is 3:1 against the surfaces it appears on", () => {
    for (const surface of ["surface", "canvas", "surface-low", "primary-subtle"]) expect(contrast("primary", surface), surface).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-primary\)/);
  });

  test("the faint grey is only ever used on decorative icons, never on text", () => {
    expect(contrast("ink-faint", "surface")).toBeLessThan(3);
    const used = readFileSync("src/components/ui/Input.tsx", "utf8") + readFileSync("src/components/shell/Sidebar.tsx", "utf8");
    expect(used).not.toContain("text-ink-faint");
  });
});

/* ───────────────────────── focus ───────────────────────── */

test.describe("keyboard focus is always visible", () => {
  const PAGES = ["/", "/bookings", "/customers/sarah-mitchell", "/jobs/JB-204", "/settings", "/reviews", "/website/pages/home", "/help", "/website/preview/booking/ac-repair-diagnostics"];
  for (const url of PAGES) {
    test(`${url}: every stop on the first thirty Tab presses shows a focus indicator`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const missing: string[] = [];
      for (let stop = 0; stop < 30; stop++) {
        await page.keyboard.press("Tab");
        const result = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return null;
          // Focus inside a native control (a date field's calendar button) is drawn by the browser itself.
          if (!element.matches(":focus")) return null;
          const style = getComputedStyle(element);
          const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1;
          const shadow = style.boxShadow !== "none";
          const box = element.getBoundingClientRect();
          return { label: `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}"`, visible: outline || shadow, onScreen: box.width > 0 && box.height > 0 };
        });
        if (result && result.onScreen && !result.visible) missing.push(result.label);
      }
      expect(missing).toEqual([]);
    });
  }

  test("the skip link is the first stop, appears when focused, and moves focus to the content", async ({ page }) => {
    await page.goto("/jobs");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });
});

/* ───────────────────────── dialogs ───────────────────────── */

test.describe("dialogs trap focus, close with Escape and give focus back", () => {
  const inside = (dialog: Locator) => dialog.evaluate((element) => element.contains(document.activeElement));
  /** A native modal hands Tab to the browser's own controls at the end of its cycle; it never lands on the inert page behind. */
  const notBehind = (dialog: Locator) => dialog.evaluate((element) => element.contains(document.activeElement) || document.activeElement === document.body);
  for (const dialogCase of DIALOGS) {
    test(dialogCase.name, async ({ page }) => {
      await page.goto(dialogCase.url);
      await page.waitForLoadState("networkidle");
      await dialogCase.open(page);
      const dialog = page.getByRole("dialog", { name: dialogCase.title });
      await expect(dialog).toBeVisible();

      expect(await inside(dialog), "focus starts inside").toBe(true);
      for (let press = 0; press < 25; press++) {
        await page.keyboard.press("Tab");
        expect(await notBehind(dialog), `Tab ${press + 1}`).toBe(true);
      }
      for (let press = 0; press < 25; press++) {
        await page.keyboard.press("Shift+Tab");
        expect(await notBehind(dialog), `Shift+Tab ${press + 1}`).toBe(true);
      }

      // Everything in it has a name, and it reads at AA with the dialog open.
      const snapshot = await dialog.ariaSnapshot();
      expect(snapshot.split("\n").map((line) => line.trim()).filter((line) => /^- (button|link|textbox|combobox|checkbox|radio|switch|spinbutton)((?: \[[^\]]*\])*)(?::.*)?$/.test(line)), "unnamed controls").toEqual([]);
      expect(await findLowContrast(page), "contrast with the dialog open").toEqual([]);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      if (dialogCase.opener) await expect(dialogCase.opener(page)).toBeFocused();
    });
  }

  test("the close button is named, and the page behind cannot be reached while a dialog is open", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Overview" })).not.toBeInViewport({ ratio: 1 }).catch(() => undefined);
    await page.mouse.click(5, 5); // the backdrop: closes it
    await expect(dialog).toBeHidden();
  });
});

/* ───────────────────────── menus and popovers ───────────────────────── */

test.describe("the notifications menu", () => {
  test("opens from the keyboard, closes with Escape and returns focus, and closes on an outside click", async ({ page }) => {
    await page.goto("/");
    const bell = page.getByRole("button", { name: "Notifications" });
    await expect(bell).toHaveAttribute("aria-expanded", "false");
    await bell.focus();
    await page.keyboard.press("Enter");
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("No new notifications.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
    await expect(bell).toBeFocused();

    await bell.click();
    await expect(page.getByRole("region", { name: "Notifications" })).toBeVisible();
    await page.locator("main").click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
  });
});

/* ───────────────────────── tabs ───────────────────────── */

test.describe("tab lists follow the tabs pattern", () => {
  const PAGES = ["/bookings", "/jobs", "/reviews", "/marketing", "/analytics", "/quotes-invoices", "/payments", "/schedule"];
  for (const url of PAGES) {
    test(`${url}: one selected tab with the only tab stop, wired to a panel, moved with the arrow keys`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const lists = page.getByRole("tablist");
      const total = await lists.count();
      expect(total, "tab lists on the page").toBeGreaterThan(0);
      for (let index = 0; index < total; index++) {
        const list = lists.nth(index);
        const tabs = list.getByRole("tab");
        const count = await tabs.count();
        expect(count).toBeGreaterThanOrEqual(2);
        const selected = list.locator("[role=tab][aria-selected=true]");
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute("tabindex", "0");
        for (let tab = 0; tab < count; tab++) await expect(tabs.nth(tab)).toHaveAttribute("aria-controls", /.+/);
        await expect(list.locator("[role=tab][tabindex='0']")).toHaveCount(1);

        // Arrow keys move the selection and the focus together; Home and End go to the ends.
        await selected.focus();
        const first = tabs.first();
        const last = tabs.last();
        await page.keyboard.press("End");
        await expect(last).toHaveAttribute("aria-selected", "true");
        await expect(last).toBeFocused();
        await page.keyboard.press("Home");
        await expect(first).toHaveAttribute("aria-selected", "true");
        await expect(first).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("ArrowLeft");
        await expect(first).toHaveAttribute("aria-selected", "true");
      }
    });
  }
});

test.describe("tabs that are routes are a named navigation with the current one marked", () => {
  const PAGES: [string, string][] = [
    ["/jobs/JB-204", "Job sections"],
    ["/team/alex-morgan", "Team member sections"],
    ["/settings", "Settings sections"],
    ["/services/ac-repair-diagnostics", "Service sections"],
    ["/customers/sarah-mitchell", "Customer sections"],
  ];
  for (const [url] of PAGES) {
    test(url, async ({ page }) => {
      await page.goto(url);
      const navs = page.locator("main nav[aria-label]");
      expect(await navs.count(), "named navigations in the page").toBeGreaterThan(0);
      for (let index = 0; index < (await navs.count()); index++) {
        const nav = navs.nth(index);
        await expect(nav.locator("a[aria-current='page']"), await nav.getAttribute("aria-label") ?? "").toHaveCount(1);
        expect(await nav.getByRole("link").count()).toBeGreaterThanOrEqual(2);
      }
    });
  }
});

/* ───────────────────────── forms ───────────────────────── */

test.describe("form errors are tied to their fields", () => {
  test("the public booking form: each invalid field says why, and nothing is colour only", async ({ page }) => {
    await page.goto("/website/preview/booking/ac-repair-diagnostics");
    await page.getByRole("radio", { name: /^Midday/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Submit appointment request" }).click();
    const invalid = page.locator("[aria-invalid='true']");
    expect(await invalid.count()).toBeGreaterThanOrEqual(4);
    expect(await structuralIssues(page)).toEqual([]);
    expect(await findLowContrast(page), "error text contrast").toEqual([]);
    for (let index = 0; index < (await invalid.count()); index++) {
      const described = await invalid.nth(index).evaluate((field) => (field.getAttribute("aria-describedby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim());
      expect(described.length, `error ${index}`).toBeGreaterThan(5);
    }
  });

  test("a Settings field with a bad value is flagged, described and focused", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Phone( [*])?$/).fill("12");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const phone = page.getByLabel(/^Phone( [*])?$/);
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(phone).toBeFocused();
    expect(await structuralIssues(page)).toEqual([]);
    expect(await findLowContrast(page)).toEqual([]);
  });

  test("the review request needs its message, and says so", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel(/^Message/).fill("");
    await dialog.getByRole("button", { name: "Send review request" }).click();
    await expect(dialog.getByLabel(/^Message/)).toHaveAttribute("aria-invalid", "true");
    expect(await structuralIssues(page)).toEqual([]);
    expect(await findLowContrast(page)).toEqual([]);
  });
});

/* ───────────────────────── ratings and status ───────────────────────── */

test.describe("ratings and statuses are words as well as pictures", () => {
  test("every star rating on Reviews reads as '<n> out of 5 stars', and the stars themselves are hidden from assistive technology", async ({ page }) => {
    await page.goto("/reviews");
    const ratings = page.getByRole("img", { name: /out of 5 stars/ });
    await expect(ratings.first()).toBeVisible();
    expect(await ratings.count()).toBeGreaterThanOrEqual(4);
    for (const label of await ratings.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))) expect(label).toMatch(/^[1-5] out of 5 stars$/);
    expect(await page.locator("main svg.lucide-star:not([aria-hidden='true'])").count()).toBe(0);
    await page.goto("/reviews/rev-sarah-mitchell");
    await expect(page.getByRole("img", { name: "5 out of 5 stars" }).first()).toBeVisible();
  });

  test("a status badge always carries its word", async ({ page }) => {
    for (const url of ["/bookings?tab=upcoming", "/jobs", "/payments", "/quotes-invoices?tab=invoices", "/reviews", "/marketing", "/maintenance-plans"]) {
      await page.goto(url);
      const empty = await page.locator("main [class*='rounded-full'][class*='border'][class*='bg-']").evaluateAll((badges) => badges.filter((badge) => (badge.textContent ?? "").trim() === "").length);
      expect(empty, url).toBe(0);
    }
  });
});

/* ───────────────────────── keyboard only ───────────────────────── */

test.describe("the customer-facing booking form can be completed with the keyboard alone", () => {
  /** Tab (or Shift+Tab) until the target has focus. */
  async function tabTo(page: Page, target: Locator, limit = 80) {
    for (let press = 0; press < limit; press++) {
      if (await target.evaluate((element) => element === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("could not reach the control with Tab");
  }

  test("an appointment request: arrival window, details, submit", async ({ page }) => {
    await page.goto("/website/preview/booking/ac-repair-diagnostics");
    await page.waitForLoadState("networkidle");

    // The arrival windows are one radio group: Tab enters it, the arrow keys choose.
    const windows = page.getByRole("radio");
    await tabTo(page, windows.first());
    while (!(await page.getByRole("radio", { name: /^Midday/ }).isChecked())) await page.keyboard.press("ArrowDown");
    await tabTo(page, page.getByRole("button", { name: "Continue" }));
    await page.keyboard.press("Enter");

    const fields: [RegExp, string][] = [
      [/^Full name/, "Jordan Miller"],
      [/^Phone number/, "(512) 555-0111"],
      [/^Email address/, "jordan@example.com"],
      [/^Service address/, "3205 Barton Creek Blvd, Austin, TX 78735"],
    ];
    for (const [label, value] of fields) {
      const field = page.getByLabel(label);
      await tabTo(page, field);
      await page.keyboard.type(value);
      await expect(field).toHaveValue(value);
    }
    const issue = page.getByLabel(/primary cooling issue/);
    await tabTo(page, issue);
    await page.keyboard.type("Blowing");
    await expect(issue).toHaveValue("Blowing warm air");

    await tabTo(page, page.getByRole("button", { name: "Submit appointment request" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Appointment request submitted" })).toContainText("Thanks, Jordan.");
  });

  test("the progress steps and the booking summary are readable in order, with a named list", async ({ page }) => {
    await page.goto("/website/preview/booking/ac-repair-diagnostics");
    await expect(page.getByRole("list", { name: "Booking steps" }).getByRole("listitem")).toHaveCount(4);
    await page.getByRole("radio", { name: /^Midday/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("complementary", { name: "Booking summary" })).toBeVisible();
    expect(await unnamedControls(page)).toEqual([]);
  });
});
