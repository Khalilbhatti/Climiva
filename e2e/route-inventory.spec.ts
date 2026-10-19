/**
 * Phase 8, Parts A, B and V. Every route is found in the app folder, opened in the production build, and held to the
 * same standard: it renders, it has no console problem or failed request, the shell around it is right, the sidebar
 * names the right module, it has one page heading, and nothing a developer wrote for themselves is on the page.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";
import { ROUTE_INVENTORY, STATE_ROUTES, moduleOf, pagePatterns } from "./route-inventory";

/** Words that belong in source comments, tests and documentation, never in the product. */
export const DEVELOPMENT_LANGUAGE: RegExp[] = [
  /module foundation ready/i,
  /\bphase \d+\b/i,
  /\bstitch\b/i,
  /screen_\d/i,
  /\bfixtures?\b/i,
  /\bprototype\b/i,
  /\bdemo\b/i,
  /development placeholder/i,
  /source[- ]of[- ]truth/i,
  /\bimplementation\b/i,
  /\btest data\b/i,
  /isn.t built yet/i,
  /\bplaceholder\b/i,
  /\blorem\b/i,
  /\btodo\b/i,
];

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** Collects problems the page causes: console output is handled by the shared fixture; this adds failed requests. */
function watchRequests(page: Page, origin: string) {
  const problems: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin === origin && response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    // Next.js cancels the background fetches it makes for links (the `_rsc` prefetches) when it no longer needs them; that is its
    // own housekeeping, not a page failing to load.
    if (request.url().includes("_rsc=") && request.failure()?.errorText === "net::ERR_ABORTED") return;
    problems.push(`failed ${request.url()}: ${request.failure()?.errorText}`);
  });
  return problems;
}

test.describe("the inventory is complete", () => {
  test("every page file in the app folder is in the inventory, and no pattern is left unexpanded", () => {
    const patterns = pagePatterns().map((entry) => entry.pattern);
    expect(patterns.length).toBeGreaterThan(50);
    for (const pattern of patterns) expect(ROUTE_INVENTORY.some((route) => route.pattern === pattern), pattern).toBe(true);
    for (const route of ROUTE_INVENTORY) expect(route.url, route.pattern).not.toMatch(/[[\]]/);
    // Every top-level module is in it.
    for (const url of ["/", "/bookings", "/schedule", "/jobs", "/customers", "/services", "/team", "/quotes-invoices", "/payments", "/maintenance-plans", "/website", "/marketplace-listing", "/reviews", "/marketing", "/analytics", "/settings", "/help"]) {
      expect(ROUTE_INVENTORY.map((route) => route.url), url).toContain(url);
    }
    expect(new Set(ROUTE_INVENTORY.map((route) => route.url)).size).toBe(ROUTE_INVENTORY.length);
  });
});

test.describe("every route renders cleanly in the production build", () => {
  for (const route of ROUTE_INVENTORY) {
    test(`${route.url}`, async ({ page, baseURL }) => {
      const problems = watchRequests(page, new URL(baseURL!).origin);
      const response = await page.goto(route.url);
      expect(response?.status(), "HTTP status").toBeLessThan(400);

      const body = page.locator("body");
      if (route.shell) {
        await expect(page.locator("main")).toBeVisible();
        await expect(page.getByRole("banner")).toHaveCount(1);
        await expect(primaryNav(page)).toHaveCount(1);
        // One module is highlighted, and it is the one that owns this URL.
        const current = primaryNav(page).locator("a[aria-current='page']");
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute("href", moduleOf(route.url));
        // The page heading: exactly one, outside any inert picture of another page.
        const headings = await page.evaluate(() => [...document.querySelectorAll("h1")].filter((heading) => !heading.closest("[inert]")).length);
        expect(headings, "visible h1 count").toBe(1);
      } else {
        // The customer-facing pages are not the workspace: no sidebar, no workspace top bar.
        await expect(primaryNav(page)).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
        const headings = await page.evaluate(() => [...document.querySelectorAll("h1")].filter((heading) => !heading.closest("[inert]")).length);
        expect(headings, "visible h1 count").toBe(1);
      }

      // The page title is read too: it is the tab's name and what a bookmark shows.
      const text = [await body.innerText(), await page.title()].join("\n");
      expect(text).not.toMatch(/this page could not be found/i);
      for (const pattern of DEVELOPMENT_LANGUAGE) expect(text, String(pattern)).not.toMatch(pattern);
      expect(problems, "failed requests").toEqual([]);
    });
  }
});

test.describe("every state of a route renders cleanly", () => {
  for (const url of STATE_ROUTES) {
    test(`${url}`, async ({ page, baseURL }) => {
      const problems = watchRequests(page, new URL(baseURL!).origin);
      const response = await page.goto(url);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("main")).toBeVisible();
      await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveAttribute("href", moduleOf(url));
      const text = await page.locator("body").innerText();
      for (const pattern of DEVELOPMENT_LANGUAGE) expect(text, String(pattern)).not.toMatch(pattern);
      expect(problems).toEqual([]);
    });
  }
});

test.describe("an unknown record is handled inside the shell", () => {
  const UNKNOWN = [
    "/customers/nobody",
    "/customers/nobody/properties",
    "/services/not-a-service",
    "/services/not-a-service/pricing",
    "/jobs/JB-999",
    "/jobs/JB-999/files",
    "/team/nobody",
    "/team/roles/not-a-role",
    "/quotes-invoices/quotes/QT-000",
    "/quotes-invoices/invoices/INV-000",
    "/payments/PAY-000",
    "/maintenance-plans/not-a-plan",
    "/website/pages/not-a-page",
    "/website/builder?page=not-a-page",
    "/reviews/not-a-review",
    "/marketing/not-a-campaign",
    "/marketing/not-a-campaign/edit",
    "/this-route-does-not-exist",
  ];
  for (const url of UNKNOWN) {
    test(`${url}`, async ({ page, consoleGuard }) => {
      consoleGuard.allow(/404/);
      await page.goto(url);
      // The workspace is still there, and the page says so in words and offers a way back.
      await expect(primaryNav(page)).toBeVisible();
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.locator("main")).toContainText(/not found|couldn.t find|isn.t in|isn.t available|doesn.t exist|can.t be found/i);
      await expect(page.locator("main").getByRole("link").first()).toBeVisible();
      await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }
});

test.describe("going back works", () => {
  test("a detail page's Back link leads to its list, and the browser's Back returns to where you were", async ({ page }) => {
    const links: [string, string, string][] = [
      ["/jobs/JB-204", "Back to Jobs", "/jobs"],
      ["/customers/sarah-mitchell", "Back to Customers", "/customers"],
      ["/services/ac-repair-diagnostics", "Back to Services", "/services"],
      ["/team/alex-morgan", "Back to Team", "/team"],
      ["/team/roles/owner", "Back to Roles", "/team/roles"],
      ["/team/roles", "Back to Team", "/team"],
      ["/quotes-invoices/quotes/QT-884", "Back to Quotes & Invoices", "/quotes-invoices"],
      ["/payments/PAY-1008", "Back to Payments", "/payments"],
      ["/maintenance-plans/plan-sarah-comfort-care", "Back to Maintenance Plans", "/maintenance-plans"],
      ["/reviews/rev-sarah-mitchell", "Back to Reviews", "/reviews"],
      ["/marketing/cmp-fall-maintenance-reminder", "Back to Marketing", "/marketing"],
    ];
    for (const [from, label, to] of links) {
      await page.goto(from);
      await page.getByRole("link", { name: label }).first().click();
      await expect(page, `${from} → ${label}`).toHaveURL(new RegExp(`${to}$`));
    }
    // The invoice's Back link keeps the Invoices tab.
    await page.goto("/quotes-invoices/invoices/INV-1044");
    await page.getByRole("link", { name: "Back to Quotes & Invoices" }).click();
    await expect(page).toHaveURL(/\/quotes-invoices\?tab=invoices$/);

    await page.goto("/");
    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await page.getByRole("tab", { name: /^Completed/ }).click();
    await page.getByRole("link", { name: "#JB-204" }).first().click();
    await expect(page).toHaveURL(/\/jobs\/JB-204$/);
    await page.goBack();
    // The tab you were on is part of the address, so Back returns to it.
    await expect(page).toHaveURL(/\/jobs\?tab=completed$/);
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
  });
});

test.describe("what the product says is the product's own words", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?)$/.test(entry) ? [path] : [];
    });
  }

  /** The text a user could see: string literals and JSX text, with comments, imports and class names set aside. */
  function userText(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const withoutImports = withoutComments.replace(/^\s*(import|export)\s[^;]*?from\s+["'][^"']+["'];?/gm, " ");
    const strings = [...withoutImports.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((match) => match[2]);
    const jsx = [...withoutImports.matchAll(/>([^<>{}]{3,})</g)].map((match) => match[1]);
    return [...strings, ...jsx].filter((text) => /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(text));
  }

  test("no string a user can see in the source names a development concept", () => {
    const hits: string[] = [];
    for (const file of [...sourceFiles("src/components"), ...sourceFiles("src/app"), ...sourceFiles("src/data")]) {
      for (const text of userText(readFileSync(file, "utf8"))) {
        for (const pattern of DEVELOPMENT_LANGUAGE) if (pattern.test(text.replace(/placeholder:/g, ""))) hits.push(`${file}: ${JSON.stringify(text.slice(0, 80))} ~ ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
