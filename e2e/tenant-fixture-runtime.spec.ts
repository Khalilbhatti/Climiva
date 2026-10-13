/**
 * What a browser is given, business by business: its own values from the database, the other businesses' values nowhere, and no business's
 * values in any script it loads. The static counterpart (tenant-fixture-boundary.spec.ts) holds the source and the emitted client files;
 * this checks the pages themselves, in a real browser, for Apex, Northstar, a business that has just been set up, and a visitor to a Site.
 *
 *   Alex    Apex only (owner)         Taylor  Northstar only (owner)
 *   Pat     signs up and sets up a business of their own (it starts with no sample data)
 */
import type { APIRequestContext, Page } from "playwright/test";
import { APEX, NORTHSTAR } from "../scripts/db/seed-lib";
import { completeOnboarding, expect, NOT_SIGNED_IN, signUp, test } from "./saas";
import { APEX_CREST, APEX_VALUES, BUSINESS_VALUES, NORTHSTAR_VALUES, SAMPLE_WORKSPACE_VALUES, foundIn } from "./tenant-values";

test.describe.configure({ timeout: 90_000 });

const EVERYTHING = [...BUSINESS_VALUES, ...SAMPLE_WORKSPACE_VALUES];
const NO_LOGO = "No logo. The initials below are shown instead.";
/** The pages of the signed-in workspace that carry the business's identity or load the most client code. */
const PAGES = ["/", "/settings", "/team", "/website", "/website/templates"];

/** A page as a browser was given it: the markup, and the same with the HTML escapes undone (a name's ampersand is written `&amp;`). */
const spellings = (html: string) => [html, html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')];

/** Every script this page has loaded so far, fetched again, so what is checked is the code a browser ran and not a guess at it. */
async function scriptsLoadedBy(page: Page): Promise<string[]> {
  const urls = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /\.js(\?|$)/.test(name)));
  return Promise.all([...new Set(urls)].map(async (url) => (await page.request.get(url)).text()));
}

/** The scripts a page's markup points at, for a visitor who has no browser here to load them. */
async function scriptsNamedIn(api: APIRequestContext, html: string): Promise<string[]> {
  const paths = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)].map((match) => match[0]))];
  return Promise.all(paths.map(async (path) => (await api.get(path)).text()));
}

test.describe("Apex", () => {
  test("Alex's workspace is Apex's, from its own rows, and no script it loads carries any business's values", async ({ openAs }) => {
    const { page, problems } = await openAs("alex");
    const scripts: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      scripts.push(...(await scriptsLoadedBy(page)));
    }
    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue(APEX.name);
    await expect(page.getByLabel(/^Phone/)).toHaveValue(APEX.phone);
    await expect(page.getByLabel(/^Email/)).toHaveValue(APEX.email);
    expect(foundIn(spellings(await page.content()), NORTHSTAR_VALUES), "Northstar in Apex's Settings").toEqual([]);
    expect(scripts.length).toBeGreaterThan(5);
    expect(foundIn(scripts, EVERYTHING)).toEqual([]);
    // The sample workspace's crest is the server's: it reaches the Branding page as data, not as part of any script.
    await page.goto("/settings/branding");
    await expect(page.getByText(APEX_CREST)).toBeVisible();
    expect(foundIn(await scriptsLoadedBy(page), EVERYTHING)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe("Northstar", () => {
  test("Taylor's workspace is Northstar's, and no Apex value is on any page or in any script", async ({ openAs }) => {
    const { page, problems } = await openAs("taylor");
    const scripts: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      expect(foundIn(spellings(await page.content()), [...APEX_VALUES, ...SAMPLE_WORKSPACE_VALUES]), path).toEqual([]);
      scripts.push(...(await scriptsLoadedBy(page)));
    }
    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue(NORTHSTAR.name);
    await expect(page.getByLabel(/^Phone/)).toHaveValue(NORTHSTAR.phone);
    expect(foundIn(scripts, EVERYTHING)).toEqual([]);
    // Northstar has no sample data and no stored logo yet, so not even the sample workspace's crest.
    await page.goto("/settings/branding");
    await expect(page.getByText(NO_LOGO)).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe("a business that has just been set up", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("starts with its own values and inherits none of Apex's or Northstar's, on any page or in any script", async ({ page }) => {
    const name = `Fresh Air Co ${Date.now().toString(36)}`;
    await signUp(page);
    await completeOnboarding(page, { name, phone: "(303) 555-0188", email: "hello@freshair.test", street: "12 Aspen Way" });

    const scripts: string[] = [];
    for (const path of [...PAGES, "/settings/branding", "/settings/profile", "/settings/hours"]) {
      await page.goto(path);
      expect(foundIn(spellings(await page.content()), EVERYTHING), path).toEqual([]);
      scripts.push(...(await scriptsLoadedBy(page)));
    }
    expect(foundIn(scripts, EVERYTHING)).toEqual([]);

    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue(name);
    await expect(page.getByLabel(/^Phone/)).toHaveValue("(303) 555-0188");
    await expect(page.getByLabel(/^Street address/)).toHaveValue("12 Aspen Way");
    await page.goto("/settings/branding");
    await expect(page.getByText(NO_LOGO)).toBeVisible();
  });
});

test.describe("a visitor to a published Site", () => {
  test("gets that business's values from the public projection, in a page whose scripts carry none", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    for (const [slug, name, other] of [
      ["apexclimate", APEX.name, NORTHSTAR_VALUES],
      ["northstar", NORTHSTAR.name, APEX_VALUES],
    ] as const) {
      const response = await visitor.get(`/sites/${slug}`);
      expect(response.status(), slug).toBe(200);
      const html = await response.text();
      // Its own name is on the page, so the page is the business's; the other business is nowhere on it.
      expect(spellings(html).some((text) => text.includes(name)), `${slug}: its own name`).toBe(true);
      expect(foundIn(spellings(html), other), `${slug}: the other business`).toEqual([]);
      const scripts = await scriptsNamedIn(visitor, html);
      expect(scripts.length, `${slug}: scripts`).toBeGreaterThan(0);
      expect(foundIn(scripts, EVERYTHING), `${slug}: scripts`).toEqual([]);
    }
  });
});
