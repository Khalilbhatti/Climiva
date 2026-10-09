/**
 * Phase 8, Part D. The search field in the top bar is on every page, so it has to do what it says: find Customers,
 * Jobs, Bookings and Schedule entries from the same records the modules show, follow the session, and be usable with
 * the keyboard alone. The matching is a pure function, tested first; then the combobox around it.
 */
import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";
import { structuralIssues, unnamedControls } from "./a11y-lint";
import { findLowContrast } from "./contrast";
import { expect as fixtureExpect, test as fixtureTest } from "./fixtures";
import { OPERATIONS } from "../src/data/operations";
import { MIN_QUERY, PER_GROUP, SEARCH_GROUPS, searchWorkspace } from "../src/lib/global-search";
import { assign } from "../src/lib/operations-state";
import { DIR } from "./apex-data";

const titles = (query: string, group?: string, data = OPERATIONS) =>
  searchWorkspace(query, data, DIR)
    .filter((result) => !group || result.group === group)
    .map((result) => result.title);

test.describe("what the search finds", () => {
  test("nothing is searched until there are two characters, and nothing odd matches", () => {
    expect(MIN_QUERY).toBe(2);
    expect(searchWorkspace("", OPERATIONS, DIR)).toEqual([]);
    expect(searchWorkspace("s", OPERATIONS, DIR)).toEqual([]);
    expect(searchWorkspace("   ", OPERATIONS, DIR)).toEqual([]);
    expect(searchWorkspace("zzzzzz", OPERATIONS, DIR)).toEqual([]);
    expect(searchWorkspace("Elena Rostova", OPERATIONS, DIR)).toEqual([]);
  });

  test("a customer's name finds the customer, their jobs and their bookings, each linking to its own page", () => {
    const results = searchWorkspace("sarah", OPERATIONS, DIR);
    expect(results.map((result) => result.group)).toEqual(expect.arrayContaining(["Customers", "Jobs", "Bookings"]));
    expect(results.find((result) => result.group === "Customers")).toMatchObject({ title: "Sarah Mitchell", href: "/customers/sarah-mitchell" });
    expect(results.find((result) => result.id === "JB-204")).toMatchObject({ group: "Jobs", title: "#JB-204 · Sarah Mitchell", href: "/jobs/JB-204" });
    expect(results.find((result) => result.id === "BK-1042")).toMatchObject({ group: "Bookings", href: "/bookings?booking=BK-1042" });
  });

  test("an id, with or without #, case-insensitive, finds the one record", () => {
    for (const query of ["JB-204", "#JB-204", "jb-204", "#jb-204"]) expect(titles(query, "Jobs"), query).toEqual(["#JB-204 · Sarah Mitchell"]);
    expect(titles("BK-1042", "Bookings")).toEqual(["#BK-1042 · Sarah Mitchell"]);
  });

  test("a phone number, in any formatting, and a street find the customer", () => {
    for (const query of ["(512) 555-0194", "512 555 0194", "5125550194", "555-0194"]) expect(titles(query, "Customers"), query).toEqual(["Sarah Mitchell"]);
    expect(titles("kinney", "Customers")).toEqual(["Sarah Mitchell"]);
    expect(titles("kinney", "Jobs")).toContain("#JB-204 · Sarah Mitchell");
  });

  test("every word typed must match, in any order", () => {
    expect(titles("sarah repair", "Jobs")).toContain("#JB-204 · Sarah Mitchell");
    expect(titles("repair sarah", "Jobs")).toContain("#JB-204 · Sarah Mitchell");
    expect(titles("sarah furnace", "Jobs")).toEqual([]);
  });

  test("a technician or a day finds the schedule entries, each linking to that day with the entry open", () => {
    const marcus = searchWorkspace("marcus", OPERATIONS, DIR);
    expect(marcus.length).toBeGreaterThan(0);
    expect(marcus.every((result) => result.group === "Schedule")).toBe(true);
    for (const result of marcus) expect(result.href).toMatch(/^\/schedule\?view=day&date=\d{4}-\d{2}-\d{2}&event=/);
    const day = searchWorkspace("oct 25", OPERATIONS, DIR).filter((result) => result.group === "Schedule");
    expect(day.length).toBeGreaterThan(0);
    for (const result of day) expect(result.href).toContain("date=2024-10-25");
  });

  test("results are grouped in a fixed order and each group shows at most four", () => {
    const results = searchWorkspace("an", OPERATIONS, DIR);
    const order = results.map((result) => SEARCH_GROUPS.indexOf(result.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const group of SEARCH_GROUPS) expect(results.filter((result) => result.group === group).length).toBeLessThanOrEqual(PER_GROUP);
  });

  test("it reads the session: reassigned work is found under its new technician", () => {
    expect(titles("samira", "Schedule").length).toBeGreaterThan(0);
    const before = searchWorkspace("samira", OPERATIONS, DIR).filter((result) => result.id === "JB-198");
    expect(before).toEqual([]);
    const after = assign(OPERATIONS, { jobId: "JB-198" }, "samira-patel");
    expect(searchWorkspace("samira", after, DIR).filter((result) => result.id === "JB-198")).toHaveLength(1);
  });
});

/* ───────────────────────── the combobox ───────────────────────── */

const box = (page: Page) => page.getByRole("combobox", { name: "Search customers, jobs, bookings and schedule" });
const list = (page: Page) => page.getByRole("listbox", { name: "Search results" });

fixtureTest.describe("the search field", () => {
  fixtureTest("typing lists grouped results, and clicking one opens it and clears the field", async ({ page }) => {
    await page.goto("/");
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await box(page).fill("sarah");
    await expect(list(page)).toBeVisible();
    await expect(box(page)).toHaveAttribute("aria-expanded", "true");
    await expect(list(page).getByRole("group", { name: "Customers" })).toBeVisible();
    await expect(list(page).getByRole("group", { name: "Jobs" })).toBeVisible();
    await expect(list(page).getByRole("group", { name: "Bookings" })).toBeVisible();
    await list(page).getByRole("option", { name: /#JB-204 · Sarah Mitchell/ }).click();
    await expect(page).toHaveURL(/\/jobs\/JB-204$/);
    await expect(box(page)).toHaveValue("");
    await expect(list(page)).toHaveCount(0);
  });

  fixtureTest("the arrow keys move through the results, Enter opens the chosen one", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("sarah");
    await expect(list(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const first = list(page).getByRole("option").first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    const id = await first.getAttribute("id");
    await expect(box(page)).toHaveAttribute("aria-activedescendant", id!);
    await page.keyboard.press("ArrowDown");
    await expect(first).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/customers\/sarah-mitchell$/);
    await expect(box(page)).toHaveValue("");
  });

  fixtureTest("ArrowUp from the field goes to the last result, and the list wraps", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("sarah");
    await page.keyboard.press("ArrowUp");
    const options = list(page).getByRole("option");
    await expect(options.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
  });

  fixtureTest("Escape closes the list, a second Escape clears the field, and focus stays in it", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("sarah");
    await expect(list(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue("sarah");
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(box(page)).toHaveValue("");
    await expect(box(page)).toBeFocused();
  });

  fixtureTest("a click elsewhere closes the list; focusing the field opens it again", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("sarah");
    await expect(list(page)).toBeVisible();
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(list(page)).toHaveCount(0);
    await box(page).focus();
    await expect(list(page)).toBeVisible();
  });

  fixtureTest("no match says so, one letter searches nothing, and the field is never a dead end", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("s");
    await expect(page.locator("[role=search]").getByRole("status")).toHaveCount(0);
    await expect(list(page)).toHaveCount(0);
    await box(page).fill("zzzz");
    await expect(page.locator("[role=search]").getByRole("status")).toHaveText("No matches for “zzzz”.");
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await box(page).fill("elena");
    await expect(list(page).getByRole("option", { name: /Elena Rodriguez/ }).first()).toBeVisible();
  });

  fixtureTest("Ctrl+K focuses it from anywhere, and a new page starts it empty", async ({ page }) => {
    await page.goto("/payments");
    await page.keyboard.press("Control+k");
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("david");
    await expect(list(page)).toBeVisible();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Team" }).click();
    await expect(page).toHaveURL(/\/team$/);
    await expect(box(page)).toHaveValue("");
    await expect(list(page)).toHaveCount(0);
  });

  fixtureTest("it follows the session: after assigning Elena's visit to Samira, searching Samira finds it on the Schedule", async ({ page }) => {
    await page.goto("/schedule");
    await page.getByRole("button", { name: "Assign technician to Elena Rodriguez" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Samira Patel/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await box(page).fill("samira");
    const entry = list(page).getByRole("option", { name: /Samira Patel · Elena Rodriguez/ });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page).toHaveURL(/\/schedule\?view=day&date=2024-10-25&event=JB-198/);
  });

  fixtureTest("the results panel fits inside the window at the narrowest audited size and reads at AA", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await box(page).fill("sarah");
    const panel = await list(page).evaluate((element) => {
      const rect = (element.parentElement as HTMLElement).getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom };
    });
    expect(panel.left).toBeGreaterThanOrEqual(0);
    expect(panel.right).toBeLessThanOrEqual(768);
    expect(panel.bottom).toBeLessThanOrEqual(1024);
    expect(await findLowContrast(page)).toEqual([]);
    expect(await unnamedControls(page)).toEqual([]);
    expect(await structuralIssues(page)).toEqual([]);
  });

  fixtureTest("what it prints is only record text, never an artefact or a stale name", async ({ page }) => {
    await page.goto("/");
    for (const query of ["an", "oct", "hannah", "repair"]) {
      await box(page).fill(query);
      const text = await page.locator("[role=search]").innerText();
      fixtureExpect(text, query).not.toMatch(/undefined|NaN|Invalid Date|\[object|Rostova/);
    }
  });
});
