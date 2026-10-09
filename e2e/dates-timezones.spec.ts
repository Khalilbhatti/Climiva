/**
 * Phase 8, Part L. Every date and time the product shows is the business's wall-clock time, formatted by hand: it
 * must not depend on the visitor's time zone, language or system clock. The same pages are opened under very different
 * browsers and compared with the baseline word for word, with no console error (a server/client mismatch would be one).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright/test";
import { expect, test } from "./fixtures";

const PAGES = [
  "/",
  "/bookings",
  "/bookings?tab=past&booking=BK-1042",
  "/schedule",
  "/schedule?view=day&date=2024-10-26",
  "/jobs",
  "/jobs/JB-204",
  "/customers/sarah-mitchell",
  "/quotes-invoices",
  "/quotes-invoices/invoices/INV-1044",
  "/payments",
  "/payments/PAY-1008",
  "/maintenance-plans",
  "/maintenance-plans/plan-sarah-comfort-care",
  "/reviews",
  "/marketing",
  "/marketing/cmp-fall-maintenance-reminder",
  "/analytics",
  "/team/alex-morgan/availability",
  "/settings/hours",
  "/website/preview/booking/annual-cooling-tune-up",
  "/marketplace/preview",
];

const BROWSERS = [
  { timezoneId: "Pacific/Auckland", locale: "en-NZ" },
  { timezoneId: "Pacific/Kiritimati", locale: "ja-JP" },
  { timezoneId: "America/Los_Angeles", locale: "en-US" },
  { timezoneId: "Asia/Kolkata", locale: "hi-IN" },
  { timezoneId: "UTC", locale: "de-DE" },
];

async function capture(context: BrowserContext, baseURL: string) {
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  const text: Record<string, string> = {};
  for (const url of PAGES) {
    await page.goto(baseURL + url);
    await page.waitForLoadState("networkidle");
    text[url] = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  }
  await page.close();
  return { text, problems };
}

type SignedIn = NonNullable<Parameters<Browser["newContext"]>[0]>["storageState"];

async function baseline(browser: Browser, baseURL: string, storageState: SignedIn) {
  const context = await browser.newContext({ storageState, timezoneId: "America/Chicago", locale: "en-US", viewport: { width: 1440, height: 900 } });
  const result = await capture(context, baseURL);
  await context.close();
  return result;
}

test.describe("the same pages read the same in any browser", () => {
  test("the baseline itself is clean and has real content", async ({ browser, baseURL, storageState }) => {
    test.setTimeout(180_000);
    const { text, problems } = await baseline(browser, baseURL!, storageState);
    expect(problems).toEqual([]);
    for (const url of PAGES) expect(text[url].length, url).toBeGreaterThan(200);
    expect(text["/payments"]).toContain("Oct 28, 2024");
  });

  for (const { timezoneId, locale } of BROWSERS) {
    test(`${timezoneId} / ${locale}: identical text, no console problems`, async ({ browser, baseURL, storageState }) => {
      test.setTimeout(240_000);
      const expected = await baseline(browser, baseURL!, storageState);
      const context = await browser.newContext({ storageState, timezoneId, locale, viewport: { width: 1440, height: 900 } });
      const actual = await capture(context, baseURL!);
      await context.close();
      expect(actual.problems).toEqual([]);
      for (const url of PAGES) expect(actual.text[url], url).toBe(expected.text[url]);
    });
  }

  test("the system clock is irrelevant: a browser set to 2031 and one set to 1999 show the same pages", async ({ browser, baseURL, storageState }) => {
    test.setTimeout(240_000);
    const expected = await baseline(browser, baseURL!, storageState);
    for (const time of ["2031-03-09T03:30:00Z", "1999-12-31T23:59:59Z"]) {
      const context = await browser.newContext({ storageState, timezoneId: "America/Chicago", locale: "en-US", viewport: { width: 1440, height: 900 } });
      await context.clock.install({ time: new Date(time) });
      const actual = await capture(context, baseURL!);
      await context.close();
      expect(actual.problems, time).toEqual([]);
      for (const url of PAGES) expect(actual.text[url], `${time} ${url}`).toBe(expected.text[url]);
    }
  });
});

test.describe("the source never reads the real clock or the browser's time zone", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?)$/.test(entry) ? [path] : [];
    });
  }

  test("no Date.now, argument-less new Date(), Intl, toLocale*, getTimezoneOffset or Math.random in src", () => {
    const stripped = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const banned: [RegExp, string][] = [
      [/Date\.now\(/, "Date.now()"],
      [/new Date\(\s*\)/, "new Date()"],
      [/\bIntl\.DateTimeFormat/, "Intl.DateTimeFormat"],
      [/\.toLocale(Date|Time)?String\(/, "toLocale*String()"],
      [/getTimezoneOffset/, "getTimezoneOffset"],
      [/Math\.random\(/, "Math.random()"],
      [/performance\.now\(/, "performance.now()"],
    ];
    // src/lib/business-time.ts is the one deliberate exception: it converts instants to a business's wall-clock time with Intl and a
    // NAMED zone, on the server, so no browser ever does. The next test holds it there.
    const SERVER_ONLY_CLOCK = join("src", "lib", "business-time.ts");
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      if (file === SERVER_ONLY_CLOCK) continue;
      const text = stripped(file);
      for (const [pattern, label] of banned) if (pattern.test(text)) hits.push(`${file}: ${label}`);
    }
    expect(hits).toEqual([]);
  });

  test("the server-only clock is never imported as a value by code that runs in a browser", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      const runsInBrowser = /^\s*(["'])use client\1/.test(text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
      if (!runsInBrowser) continue;
      for (const match of text.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']@\/lib\/business-time["']/g)) if (!match[1]) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
