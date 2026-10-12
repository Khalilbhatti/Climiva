import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const kpis = (page: Page) => page.getByRole("region", { name: "Key metrics" });

const ROUTES = [
  "/",
  "/bookings",
  "/schedule",
  "/jobs",
  "/customers",
  "/services",
  "/team",
  "/quotes-invoices",
  "/payments",
  "/maintenance-plans",
  "/website",
  "/marketplace",
  "/reviews",
  "/marketing",
  "/analytics",
  "/analytics?tab=bookings-jobs",
  "/analytics?tab=financial",
  "/analytics?tab=plans",
  "/analytics?range=last-month",
  "/settings",
  "/settings/hours",
  "/settings/branding",
  "/settings/preferences",
  "/settings/profile",
  "/help",
];

test.describe("the Overview baseline is unchanged", () => {
  test("24 Bookings, 18 Completed Jobs, $6,240 invoiced, $2,130 received from 7 payments", async ({ page }) => {
    await page.goto("/");
    await expect(kpis(page)).toContainText("24");
    await expect(kpis(page)).toContainText("18");
    await expect(kpis(page)).toContainText("$6,240");
    await expect(kpis(page)).toContainText("$2,130");
    await expect(kpis(page)).toContainText("7 recorded non-voided payments");
    await expect(primaryNav(page).getByRole("link", { name: /^Bookings/ })).toContainText("24");
    await expect(primaryNav(page).getByRole("link", { name: /^Jobs/ })).toContainText("18");
  });

  test("its Business information card is the saved Settings and links to them; it holds no Analytics", async ({ page, workerTenant }) => {
    await page.goto("/");
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText("Apex Climate Heating & Air");
    await expect(card).toContainText("(555) 392-8100");
    await expect(card).toContainText("service@apexclimate.com");
    await expect(card).toContainText("4820 East Riverside Dr, Suite 110");
    await expect(card).toContainText("Austin, TX 78741");
    await expect(card).toContainText("Mon–Fri: 7:30 AM–6:00 PM");
    await expect(card).toContainText("Sat: 8:00 AM–2:00 PM");
    await expect(card).toContainText("Sun: Closed");
    await expect(card).toContainText(`${workerTenant.platformSlug}.climvia.com`);
    await expect(card.getByRole("link", { name: /Manage Settings/ })).toHaveAttribute("href", "/settings");
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Weekly Bookings and completed Jobs" })).toHaveCount(0);
  });

  test("a payment recorded in the session moves the Overview and Analytics together, and only the money", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByRole("radio", { name: /INV-1050/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Payment recorded" }).getByRole("button", { name: "Close", exact: true }).click();

    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(kpis(page)).toContainText("$2,430");
    await expect(kpis(page)).toContainText("8 recorded non-voided payments");
    await expect(kpis(page)).toContainText("$6,240");
    await expect(kpis(page)).toContainText("24");
    await expect(kpis(page)).toContainText("18");
    await primaryNav(page).getByRole("link", { name: "Analytics" }).click();
    await expect(kpis(page)).toContainText("$2,430");
    await expect(kpis(page)).toContainText("$6,240");
  });
});

test.describe("every route still renders inside the real shell", () => {
  for (const route of ROUTES) {
    test(`${route} renders with the primary navigation and no console problems`, async ({ page }) => {
      await page.goto(route);
      await expect(primaryNav(page)).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      // The shell is the same one on every route: one header, one primary navigation.
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);
    });
  }

  test("Analytics and Settings have their own titles and the Settings item is highlighted on every Settings route", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page).toHaveTitle(/Analytics/);
    await expect(primaryNav(page).getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
    for (const route of ["/settings", "/settings/hours", "/settings/branding", "/settings/preferences", "/settings/profile"]) {
      await page.goto(route);
      await expect(page).toHaveTitle(/Settings/);
      await expect(primaryNav(page).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("customer-facing previews stay outside the shell and read Settings", () => {
  for (const route of ["/website/preview", "/website/preview/contact", "/website/preview/booking", "/marketplace/preview"]) {
    test(`${route} has no workspace sidebar, top bar or Settings controls`, async ({ page }) => {
      await page.goto(route);
      await expect(primaryNav(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
      await expect(page.locator("body")).toContainText("Apex Climate Heating & Air");
    });
  }
});

test.describe("source scan", () => {
  const PROHIBITED = [
    /ai insight/,
    /ai-powered/,
    /ai assist/,
    /recommendation/,
    /forecast/,
    /technician performance/,
    /telemetry/,
    /\bledger\b/,
    /audit log/,
    /accounting sync/,
    /\bntp\b/,
    /server time/,
    /verification badge/,
    /business verification/,
    /\bdispatch/,
    /\bfleet\b/,
    /seo analytics/,
    /marketing attribution/,
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|css)$/.test(entry) ? [path] : [];
    });
  }

  test("production source contains none of the Phase 7 prohibited concepts", () => {
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of PROHIBITED) if (phrase.test(text)) hits.push(`${file}: ${phrase}`);
    }
    expect(hits).toEqual([]);
  });

  test("Analytics and Settings code never reads the real clock, Intl or the browser's timezone", () => {
    const files = [...sourceFiles("src/components/analytics"), ...sourceFiles("src/components/settings"), ...sourceFiles("src/lib").filter((file) => /analytics|settings|report|pdf|display/.test(file)), ...sourceFiles("src/data").filter((file) => /analytics|settings/.test(file))];
    expect(files.length).toBeGreaterThan(8);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const banned of ["Date.now", "new Date(", "Intl.", "toLocale", "getTimezoneOffset", "performance.now"]) if (text.includes(banned)) hits.push(`${file}: ${banned}`);
    }
    expect(hits).toEqual([]);
  });

  test("Analytics owns no records: it stores nothing, calls no network and edits nothing", () => {
    const hits: string[] = [];
    for (const file of [...sourceFiles("src/components/analytics"), "src/lib/analytics-state.ts", "src/lib/report-export.ts", "src/lib/pdf.ts", "src/data/analytics.ts"]) {
      const text = readFileSync(file, "utf8");
      for (const banned of ["localStorage", "sessionStorage", "indexedDB", "fetch(", "XMLHttpRequest", "navigator.sendBeacon", "useState<Booking", "createBooking", "recordPayment"]) if (text.includes(banned)) hits.push(`${file}: ${banned}`);
    }
    expect(hits).toEqual([]);
  });
});
