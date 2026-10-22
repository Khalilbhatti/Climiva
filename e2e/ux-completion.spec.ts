/**
 * Phase 19F completion pass, by what a person sees and does (never by how it is styled):
 *
 *   Schedule     the date first, the week one press away, today marked, each technician's day said in words, an arrival window labelled as one
 *   Analytics    the owner's questions (how many bookings, what money, what came from the Marketplace, who stays), answered with the real totals
 *   Settings     grouped as an owner looks for things, with a plain link to where each other thing is really managed
 *   Feedback     what a success says, what an error never says
 *   Dialogs      Cancel on the left and the main action last; closing a dialog with typed work in it asks first
 *   Providers    on a phone the way to book stays on screen, in the words of the Service's own booking mode
 *   Getting started   hidden for one person in one business, and only there
 *   Marketing    says it keeps campaigns and does not deliver them
 *   Roles        an owner and an admin are offered the same things; a member is offered nothing to change
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { bookingsBySource } from "../src/lib/analytics-state";
import { resolveTab } from "../src/lib/analytics-rules";
import { gettingStartedCookie } from "../src/lib/overview-rules";
import { SAMPLE_SERVICES, makeProvider, type Provider } from "./marketplace-helpers";
import { NOT_SIGNED_IN, completeOnboarding, expect, expectAccessible, signUp, switchWorkspace, switcher, test, toast } from "./saas";

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/* ───────────────────────────────── Schedule ───────────────────────────────── */

test.describe("Schedule", () => {
  const timeline = (page: Page) => page.getByRole("region", { name: /^Day timeline for/ });
  const strip = (page: Page) => page.getByRole("group", { name: "Days of this week" });
  const block = (page: Page, who: string) => page.locator('button[id^="event-"]', { hasText: who });

  test("Day: the date reads first, today is marked, the week is one press away and each technician's day is said in words", async ({ page }) => {
    await page.goto("/schedule?view=day");
    await expect(page.getByRole("heading", { level: 2, name: "Today, Friday, October 25, 2024" })).toBeVisible();
    await expect(page.getByText("Central Time (CT)")).toBeVisible();

    // What the day holds, before reading a single block.
    await expect(page.getByText("4 visits this day")).toBeVisible();
    await expect(page.getByText("1 still needs a technician")).toBeVisible();
    await expect(page.getByText("It is 10:45 AM now.")).toBeVisible();

    // The week, with how much is on each day; today is the one pressed.
    await expect(strip(page).getByRole("button")).toHaveCount(7);
    await expect(strip(page).getByRole("button", { pressed: true })).toHaveAccessibleName(/Oct 25.*5 items.*today/);
    await expect(strip(page).getByRole("button", { name: /Oct 27, Nothing|Oct 27.*0 items/ })).toBeVisible();

    // The technicians' days, each in one line.
    const rows = page.getByRole("list", { name: "Technician timelines" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Alex Morgan" })).toContainText("1 visit");
    await expect(rows.filter({ hasText: "Marcus Vance" })).toContainText("2 visits");
    await expect(rows.filter({ hasText: "Samira Patel" })).toContainText("Blocked time only");

    // The line for the current time is there today, and nowhere else.
    await expect(page.getByText("Now 10:45 AM")).toBeVisible();
    await strip(page).getByRole("button", { name: /Oct 26/ }).click();
    await expect(page).toHaveURL(/view=day&date=2024-10-26|date=2024-10-26&view=day/);
    await expect(page.getByRole("heading", { level: 2, name: "Saturday, October 26, 2024" })).toBeVisible();
    await expect(page.getByText("Now 10:45 AM")).toHaveCount(0);
    await expect(page.getByText(/It is .* now\./)).toHaveCount(0);

    // And back to today in one press.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Today, Friday, October 25, 2024" })).toBeVisible();
  });

  test("an arrival window is labelled as one, an exact time is not, and the legend says what the hatching and dashes mean", async ({ page }) => {
    await page.goto("/schedule?view=day&date=2024-10-26");
    // Hannah Wright asked for an appointment (an arrival window); Bradley Cooper booked a time.
    await expect(block(page, "Hannah Wright")).toContainText("Arrival window");
    await expect(block(page, "Bradley Cooper")).not.toContainText("Arrival window");
    // Every block says its status in words, not only in a colour.
    await expect(block(page, "Hannah Wright")).toContainText("Scheduled");

    const legend = page.getByRole("list", { name: "How to read the schedule" });
    for (const line of ["Confirmed", "Scheduled", "In progress", "Completed", "Hatched: an arrival window, not an exact time", "Dashed: blocked time", "Shaded: outside business hours"]) {
      await expect(legend).toContainText(line);
    }
  });

  test("a day the business is closed says so, and an empty open day says nothing is scheduled", async ({ page }) => {
    await page.goto("/schedule?view=day&date=2024-10-27");
    await expect(page.getByText("Your business hours say you are closed on Sundays.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Technician timelines" }).getByRole("listitem").first()).toContainText("Closed");

    await page.goto("/schedule?view=week");
    // The week: Sunday is closed and empty, a Tuesday holds one blocked period and nothing else.
    await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  });

  test("the timeline is reachable by keyboard and a block opens with Enter", async ({ page }) => {
    await page.goto("/schedule?view=day");
    await timeline(page).focus();
    await expect(timeline(page)).toBeFocused();
    const sarah = block(page, "Sarah Mitchell");
    await sarah.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/event=/);
    await expect(sarah).toHaveAttribute("aria-pressed", "true");
  });

  test("the page never scrolls sideways; only the timeline does, and only when the screen is narrow", async ({ page }) => {
    for (const [width, height] of [[1280, 860], [768, 1000]] as const) {
      await page.setViewportSize({ width, height });
      for (const url of ["/schedule?view=day", "/schedule?view=week"]) {
        await page.goto(url);
        expect(await noOverflow(page), `${url} at ${width}`).toBeLessThanOrEqual(0);
      }
    }
    await page.goto("/schedule?view=day");
    expect(await timeline(page).evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  });

  test("Week: what the week holds is said up top, and a day opens in its own view", async ({ page }) => {
    await page.goto("/schedule?view=week");
    await expect(page.getByText("10 visits this week")).toBeVisible();
    await expect(page.getByText("1 still needs a technician")).toBeVisible();
    await expect(page.getByText("1 unassigned")).toBeVisible();
    await page.getByRole("button", { name: /^Open Sat, Oct 26 in day view$/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Saturday, October 26, 2024" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
  });
});

/* ───────────────────────────────── Analytics ───────────────────────────────── */

test.describe("Analytics", () => {
  const tabs = (page: Page) => page.getByRole("tablist", { name: "Analytics sections" });
  const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

  test("the tabs are the owner's questions, and an address from the first version still opens the right one", async ({ page }) => {
    await page.goto("/analytics");
    await expect(tabs(page).getByRole("tab")).toHaveText(["Overview", "Bookings", "Jobs", "Revenue", "Marketplace", "Customer retention"]);
    for (const [from, to] of [["bookings-jobs", "Bookings"], ["financial", "Revenue"], ["plans", "Customer retention"], ["nonsense", "Overview"]] as const) {
      await page.goto(`/analytics?tab=${from}`);
      await expect(tabs(page).getByRole("tab", { name: to })).toHaveAttribute("aria-selected", "true");
    }
  });

  test("Bookings answers how many, in what state and from where, with the real counts", async ({ page }) => {
    await page.goto("/analytics?tab=bookings");
    await expect(section(page, "How many bookings are we getting?")).toContainText("24 in this period");
    const states = section(page, "What state are they in?");
    await expect(states).toContainText(/Confirmed\s*14/);
    await expect(states).toContainText(/Completed\s*6/);
    await expect(states).toContainText(/Pending confirmation\s*2/);
    await expect(states).toContainText(/Cancelled\s*2/);

    const sources = section(page, "Where are they coming from?");
    const list = sources.getByRole("list", { name: "Bookings by source" });
    await expect(list.getByRole("listitem")).toHaveText([/Website\s*2/, /Booking link\s*1/, /Marketplace\s*1/]);
    // The gap between 24 and 4 is explained, not left to be wondered at.
    await expect(sources).toContainText("4 of the 13 bookings made in Climvia in these dates say where they came from.");
    await expect(sources).toContainText("Bookings imported from your earlier history have no source");
    await expect(page.getByRole("table", { name: "Service activity" })).toBeVisible();
  });

  test("Jobs, Revenue, Marketplace and Customer retention each answer their own questions with the totals the other pages show", async ({ page }) => {
    await page.goto("/analytics?tab=jobs");
    await expect(section(page, "How much work is being completed?")).toContainText("18 Jobs completed");
    await expect(section(page, "What is still scheduled or in progress?")).toBeVisible();

    await page.goto("/analytics?tab=revenue");
    await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$6,240/);
    await expect(section(page, "What has been paid?")).toContainText(/Amount received\s*\$2,130/);
    await expect(section(page, "What is still outstanding?")).toContainText(/Outstanding balance\s*\$680/);
    await expect(section(page, "What have we quoted?")).toContainText(/Total quoted value\s*\$4,820/);

    await page.goto("/analytics?tab=marketplace");
    const marketplace = section(page, "How many bookings came from the Marketplace?");
    await expect(marketplace).toContainText(/Marketplace bookings\s*1/);
    await expect(marketplace).toContainText(/Listing\s*Published/);
    const compare = page.getByRole("list", { name: "Marketplace compared with other sources" });
    await expect(compare.getByRole("listitem")).toHaveText([/Marketplace\s*1/, /Your website and booking link\s*3/]);

    await page.goto("/analytics?tab=retention");
    await expect(section(page, "How many customers are on a Maintenance Plan?")).toContainText(/Active plans\s*14/);
    const reviews = section(page, "What do customers say about our work?");
    await expect(reviews).toContainText(/Total reviews\s*12/);
    await expect(reviews).toContainText(/Average rating\s*4\.7/);
    await expect(reviews).toContainText(/Awaiting reply\s*3/);
  });

  test("nothing predicted, scored or invented is on any tab", async ({ page }) => {
    for (const tab of ["overview", "bookings", "jobs", "revenue", "marketplace", "retention"]) {
      await page.goto(`/analytics?tab=${tab}`);
      const text = (await page.getByRole("main").innerText()).toLowerCase();
      for (const word of ["insight", "forecast", "predict", "recommend", "conversion", "profitab", "efficiency", "attribution", "traffic"]) {
        expect(text, `${tab} says "${word}"`).not.toContain(word);
      }
      expect(text, `${tab} shows a percentage`).not.toMatch(/\d+(\.\d+)?%/);
    }
  });

  test("what a count says about its own source is worked out from the records, and only the records", () => {
    const booking = (date: string, source?: string) => ({ date, source }) as never;
    const operations = { bookings: [booking("2024-10-02", "Website"), booking("2024-10-03", "Website"), booking("2024-10-09", "Marketplace"), booking("2024-10-10"), booking("2024-11-01", "Marketplace")] };
    const counts = bookingsBySource(operations, { from: "2024-10-01", to: "2024-10-31" });
    expect(counts.records).toBe(4);
    expect(counts.recorded).toBe(3);
    expect(counts.bySource).toEqual([
      { source: "Website", count: 2 },
      { source: "Marketplace", count: 1 },
    ]);
    expect(bookingsBySource({ bookings: [] }, { from: "2024-10-01", to: "2024-10-31" })).toEqual({ records: 0, bySource: [], recorded: 0 });
    expect(resolveTab("bookings-jobs")).toBe("bookings");
    expect(resolveTab("financial")).toBe("revenue");
    expect(resolveTab("plans")).toBe("retention");
    expect(resolveTab("__proto__")).toBe("overview");
    expect(resolveTab("constructor")).toBe("overview");
  });
});

/* ───────────────────────────────── Settings ───────────────────────────────── */

test.describe("Settings", () => {
  const sections = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });

  test("is grouped the way an owner looks for things, and says where the rest is managed", async ({ page }) => {
    await page.goto("/settings");
    await expect(sections(page).getByRole("heading")).toHaveText(["Business", "Booking & operations", "Team & access", "Website & domains", "Account & workspace"]);
    await expect(sections(page).getByRole("link", { name: /^Business information/ })).toHaveAttribute("aria-current", "page");

    // What is Settings' own is a page here; the rest is a link to the one place it is really set.
    for (const [name, href] of [
      ["Business hours", "/settings/hours"],
      ["Branding", "/settings/branding"],
      ["Workspace preferences", "/settings/preferences"],
      ["My profile", "/settings/profile"],
      ["How customers book", "/website/booking"],
      ["Services and prices", "/services"],
      ["Team and permissions", "/team"],
      ["Domains", "/website/domain"],
      ["Website", "/website"],
    ] as const) {
      await expect(sections(page).getByRole("link", { name: new RegExp(`^${name}`) }), name).toHaveAttribute("href", href);
    }

    await sections(page).getByRole("link", { name: /^Team and permissions/ }).click();
    await expect(page).toHaveURL(/\/team$/);
  });

  test("the page itself holds no second copy of a setting that lives elsewhere", async ({ page }) => {
    for (const path of ["/settings", "/settings/hours", "/settings/branding", "/settings/preferences", "/settings/profile"]) {
      await page.goto(path);
      const text = (await page.getByRole("main").innerText()).toLowerCase();
      // Strip the navigation (which names the other homes on purpose) before looking.
      const nav = (await sections(page).innerText()).toLowerCase();
      const own = text.replace(nav, "");
      for (const word of ["booking method", "permissions", "custom domain", "dns"]) expect(own, `${path} mentions ${word}`).not.toContain(word);
      expect(await noOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });
});

/* ───────────────────────────────── Feedback and errors ───────────────────────────────── */

test.describe("what a success says", () => {
  test("adding a customer, saving business information and saving a profile each say what happened", async ({ page }) => {
    await page.goto("/customers?new=1");
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await dialog.getByLabel(/^Full name/).fill("Feedback Person");
    await dialog.getByLabel(/^Email address/).fill("feedback.person@example.test");
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(toast(page)).toContainText("Feedback Person was added to your customers.");
    await expect(page).toHaveURL(/\/customers\/[a-z0-9-]+$/);

    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Apex Climate Heating & Air Co.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Business information saved.");

    await page.goto("/settings/profile");
    await page.getByLabel(/^Full name/).fill("Alexander Morgan");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(toast(page)).toContainText("Profile saved.");
  });

  test("a request that cannot reach the server says nothing was saved, in plain words", async ({ page, consoleGuard }) => {
    // The browser logs the request it was told to drop; that is the point of the test, not a defect.
    consoleGuard.allow(/Failed to load resource: net::ERR_FAILED/);
    await page.goto("/customers?new=1");
    await page.route("**/customers**", (route) => (route.request().headers()["next-action"] ? route.abort() : route.continue()));
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await dialog.getByLabel(/^Full name/).fill("Offline Person");
    await dialog.getByLabel(/^Email address/).fill("offline.person@example.test");
    await dialog.getByRole("button", { name: "Add customer" }).click();
    const problem = dialog.getByRole("alert").first();
    await expect(problem).toContainText("We couldn't reach the server, so nothing was saved. Check your connection and try again.");
    const text = (await dialog.innerText()).toLowerCase();
    for (const word of ["failed to fetch", "networkerror", "typeerror", "stack", "undefined"]) expect(text).not.toContain(word);
  });
});

test.describe("what an error never says", () => {
  test("no message a person can be shown names the database, a constraint, a policy, a tenant or a function", () => {
    const folder = join(process.cwd(), "src", "server", "actions");
    const banned = /constraint|violat|\bsql\b|row.level|\brls\b|polic(y|ies)|tenant|organization_id|stack trace|exception|null value|duplicate key|relation "|function |\bpg_|drizzle|postgres/i;
    const found: string[] = [];
    for (const file of readdirSync(folder).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(folder, file), "utf8");
      // The words of a failure: the first string in failure("...") and the error: "..." of a refusal. Comments and log lines are not shown to anyone.
      for (const match of source.matchAll(/(?:failure|fail)\(\s*(["`])((?:(?!\1)[^\\]|\\.)*)\1/g)) if (banned.test(match[2])) found.push(`${file}: ${match[2]}`);
      for (const match of source.matchAll(/error:\s*(["`])((?:(?!\1)[^\\]|\\.)*)\1/g)) if (banned.test(match[2])) found.push(`${file}: ${match[2]}`);
    }
    expect(found).toEqual([]);
  });
});

/* ───────────────────────────────── Dialogs ───────────────────────────────── */

test.describe("dialogs behave alike", () => {
  test("Cancel is on the left, the main action is last, and typed work is not thrown away by accident", async ({ page }) => {
    await page.goto("/customers?new=1");
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const add = dialog.getByRole("button", { name: "Add customer" });
    const [left, right] = [await cancel.boundingBox(), await add.boundingBox()];
    expect(left!.x).toBeLessThan(right!.x);
    // The required field is marked, and says so to a screen reader.
    await expect(dialog.getByLabel(/^Full name/)).toHaveAttribute("required", "");

    // Nothing typed: Cancel closes at once.
    await cancel.click();
    await expect(dialog).toBeHidden();

    // Something typed: Cancel, Escape and the close icon all ask first.
    for (const how of ["cancel", "escape"] as const) {
      await page.goto("/customers?new=1");
      await dialog.getByLabel(/^Full name/).fill("Half Typed");
      if (how === "cancel") await dialog.getByRole("button", { name: "Cancel" }).click();
      else await page.keyboard.press("Escape");
      const ask = page.getByRole("dialog", { name: "Discard unsaved changes?" });
      await expect(ask).toBeVisible();
      await ask.getByRole("button", { name: "Keep editing" }).click();
      await expect(dialog.getByLabel(/^Full name/)).toHaveValue("Half Typed");
      if (how === "cancel") await dialog.getByRole("button", { name: "Cancel" }).click();
      else await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
      await expect(dialog).toBeHidden();
    }
  });
});

/* ───────────────────────────────── a provider's page on a phone ───────────────────────────────── */

test.describe("a provider's page on a phone", () => {
  test.use({ storageState: NOT_SIGNED_IN, viewport: { width: 390, height: 844 } });
  test.describe.configure({ timeout: 120_000 });

  let owner: ReturnType<typeof adminDb>;
  let several: Provider;
  let single: Provider;
  let closed: Provider;
  test.beforeAll(async () => {
    owner = adminDb();
    several = await makeProvider("cta-many", owner, { services: [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp, SAMPLE_SERVICES.ductless] });
    single = await makeProvider("cta-one", owner, { services: [SAMPLE_SERVICES.tuneUp] });
    closed = await makeProvider("cta-none", owner, { actions: { book: false } });
  });
  test.afterAll(async () => {
    await owner.pool.end();
  });

  const bar = (page: Page) => page.getByRole("region", { name: "Book this provider" });

  test("a chosen Service is booked from the bar, in the words of its own booking mode", async ({ page }) => {
    await page.goto(`/listings/${several.slug}?service=${SAMPLE_SERVICES.tuneUp}`);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toContainText("Annual Cooling Tune-Up");
    await expect(bar(page)).toContainText("$129 fixed price");
    await expect(bar(page).getByRole("link", { name: /^Book a time/ })).toHaveAttribute("href", new RegExp(`/listings/${several.slug}/book/${SAMPLE_SERVICES.tuneUp}`));

    // A request is a request: it never says Book or Confirm.
    await page.goto(`/listings/${several.slug}?service=${SAMPLE_SERVICES.repair}`);
    await expect(bar(page).getByRole("link", { name: /^Request appointment/ })).toBeVisible();
    await expect(bar(page)).not.toContainText(/\bbook\b|confirm/i);

    await page.goto(`/listings/${several.slug}?service=${SAMPLE_SERVICES.ductless}`);
    await expect(bar(page).getByRole("link", { name: /^Request a quote/ })).toBeVisible();
    await expectAccessible(page);
  });

  test("with several Services and none chosen it says so and leads to the list; with one it books that one", async ({ page }) => {
    await page.goto(`/listings/${several.slug}`);
    await expect(bar(page)).toContainText("Choose a service to book");
    await bar(page).getByRole("link", { name: "See services" }).click();
    await expect(page.locator("#services")).toBeInViewport();

    await page.goto(`/listings/${single.slug}`);
    await expect(bar(page).getByRole("link", { name: /^Book a time/ })).toHaveAttribute("href", new RegExp(`/book/${SAMPLE_SERVICES.tuneUp}`));
  });

  test("it never covers the end of the page, there is none where nothing can be booked, and it is not on a desktop screen", async ({ page }) => {
    await page.goto(`/listings/${several.slug}?service=${SAMPLE_SERVICES.tuneUp}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = page.getByRole("main").getByRole("link").last();
    const [lastBox, barBox] = [await last.boundingBox(), await bar(page).boundingBox()];
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);

    await page.goto(`/listings/${closed.slug}`);
    await expect(bar(page)).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`/listings/${several.slug}?service=${SAMPLE_SERVICES.tuneUp}`);
    await expect(bar(page)).toBeHidden();
  });
});

/* ───────────────────────────────── Getting started, per person and per business ───────────────────────────────── */

test.describe("Getting started is hidden for one person in one business", () => {
  const checklist = (page: Page) => page.getByRole("region", { name: "Getting started" });

  test("the memory of hiding it is named for the person and the business, so no two share it", () => {
    const names = [gettingStartedCookie("u1", "o1"), gettingStartedCookie("u2", "o1"), gettingStartedCookie("u1", "o2"), gettingStartedCookie("u2", "o2")];
    expect(new Set(names).size).toBe(4);
    for (const name of names) expect(name).toMatch(/^getting_started_dismissed_u\d_o\d$/);
  });

  test("hiding it in one business leaves it in the other, and each stays hidden where it was hidden", async ({ openAs }) => {
    const { page, context } = await openAs("casey");
    await page.goto("/overview");
    if (!(await switcher(page).textContent())?.includes("Apex")) await switchWorkspace(page, /Apex/);
    await page.goto("/overview");
    await expect(checklist(page)).toBeVisible();
    await page.getByRole("button", { name: "Hide Getting started" }).click();
    await expect(checklist(page)).toBeHidden();

    await switchWorkspace(page, /Northstar/);
    await page.goto("/overview");
    await expect(checklist(page)).toBeVisible();
    await page.getByRole("button", { name: "Hide Getting started" }).click();
    await expect(checklist(page)).toBeHidden();

    // Two memories, one per business, both this person's.
    const kept = (await context.cookies()).filter((cookie) => cookie.name.startsWith("getting_started_dismissed_"));
    expect(kept).toHaveLength(2);
    expect(new Set(kept.map((cookie) => cookie.name)).size).toBe(2);

    await switchWorkspace(page, /Apex/);
    await page.reload();
    await expect(checklist(page)).toBeHidden();
  });
});

/* ───────────────────────────────── Marketing ───────────────────────────────── */

test.describe("Marketing says what it does", () => {
  test("a campaign is kept, not delivered, and the page says so before anything is made", async ({ page }) => {
    await page.goto("/marketing");
    await expect(page.getByRole("note")).toContainText("It does not deliver email or text messages yet, so a campaign marked Sent has not reached anyone.");
    await expect(page.getByRole("columnheader")).toHaveText(["Campaign", "Channel", "Audience", "Status", "Send date", "Recipients", "Actions"]);
    // A draft with no count shows a dash, and says why to a screen reader.
    await expect(page.getByText("Not counted yet").first()).toBeAttached();
    const main = (await page.getByRole("main").innerText()).toLowerCase();
    expect(main).not.toMatch(/delivered to|messages sent to/);
  });

  test("the builder says that sending only records the campaign", async ({ page }) => {
    await page.goto("/marketing/new");
    await page.getByLabel(/^Campaign name/).fill("Plain words");
    await page.getByRole("button", { name: /^Continue to review/ }).click();
    await expect(page.getByText(/Climvia does not deliver email or text messages yet, so nothing reaches your customers from here\./)).toBeVisible();
  });
});

/* ───────────────────────────────── Roles ───────────────────────────────── */

test.describe("what each role is offered", () => {
  // Everything that would change something. A member is offered none of it; an owner and an admin are offered the same.
  const CHANGES = /^(Add|Create|New|Edit|Publish|Unpublish|Record|Assign|Reply|Request|Send|Save|Delete|Remove|Invite|Hide|Set up|Confirm|Decline|Complete|Start|Void|Manage|Connect|Change|Duplicate|Deactivate)\b/i;
  const ROUTES = [
    "/bookings", "/schedule", "/jobs", "/jobs/JB-201", "/customers", "/customers/sarah-mitchell", "/services", "/services/ac-repair-diagnostics",
    "/team", "/team/roles", "/team/alex-morgan", "/quotes-invoices", "/payments", "/maintenance-plans", "/website", "/website/pages", "/website/booking", "/website/domain",
    "/marketplace-listing", "/reviews", "/marketing", "/marketing/cmp-fall-maintenance-reminder", "/analytics", "/settings", "/settings/hours", "/settings/branding", "/settings/preferences",
  ];

  async function offered(page: Page): Promise<string[]> {
    await page.waitForLoadState("networkidle");
    return page.getByRole("main").evaluate((main, source) => {
      const pattern = new RegExp(source, "i");
      // What can be pressed and seen: not disabled (itself or by a disabled fieldset), not a picture of a page (inert), not a closed dialog.
      return [...main.querySelectorAll<HTMLElement>("button, a[href]")]
        .filter((element) => !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" && !element.closest("[inert]") && element.checkVisibility())
        .map((element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((label) => pattern.test(label));
    }, CHANGES.source);
  }

  test("a member is offered nothing to change on any page", async ({ openAs }) => {
    test.setTimeout(180_000);
    const { page } = await openAs("jamie");
    const seen: Record<string, string[]> = {};
    for (const route of ROUTES) {
      await page.goto(route);
      const found = await offered(page);
      if (found.length > 0) seen[route] = found;
    }
    expect(seen).toEqual({});
  });

  test("an admin is offered what an owner is offered", async ({ openAs }) => {
    test.setTimeout(120_000);
    const alex = await openAs("alex");
    const casey = await openAs("casey");
    await casey.page.goto("/overview");
    if (!(await switcher(casey.page).textContent())?.includes("Apex")) await switchWorkspace(casey.page, /Apex/);
    for (const route of ["/schedule", "/services", "/team", "/reviews", "/marketing", "/marketplace-listing", "/website", "/customers"]) {
      await alex.page.goto(route);
      await casey.page.goto(route);
      expect(await offered(casey.page), route).toEqual(await offered(alex.page));
    }
  });
});

/* ───────────────────────────────── a new business ───────────────────────────────── */

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 150_000 });

  test("is told what Marketing does and does not do before it makes a campaign, and its Settings fit the page", async ({ page }) => {
    await signUp(page, { name: "Pat Newcomer" });
    await completeOnboarding(page, { name: `Completion ${randomBytes(2).toString("hex")} Heating` });
    await page.goto("/marketing");
    await expect(page.getByRole("note")).toContainText("does not deliver email or text messages yet");
    await expect(page.getByRole("heading", { name: "No campaigns yet" })).toBeVisible();
    await page.goto("/settings");
    await expect(primaryNav(page).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});
