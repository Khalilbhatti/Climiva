/**
 * Settings are stored in PostgreSQL: they survive a reload and a fresh login, they reach the rest of the workspace from the
 * stored copy, the server re-checks everything the form checked, and a failed save never leaves the screen ahead of the
 * database. Every test here edits the worker's own copy of the Apex workspace, restored before each test.
 */
import type { APIRequestContext, Page } from "playwright/test";
import { business } from "../scripts/db/seed-data/apex";
import { ensureTestTenant, resetTestTenant } from "../scripts/db/seed-lib";
import { adminDb } from "../scripts/db/lib";
import { expect, formAlert, hydrated, ORIGIN, test, toast, waitsForHydration, watchConsole } from "./saas";
import { signInOverHttp } from "./fixtures";

const save = async (page: Page, label: string, saved: string) => {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(toast(page)).toContainText(saved);
};

/** The request a Server Action call makes, so it can be sent again by someone else or with different arguments. */
type Captured = { url: string; headers: Record<string, string>; body: string };

async function captureAction(page: Page, trigger: () => Promise<void>): Promise<Captured> {
  const pending = page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  await trigger();
  const request = await pending;
  const headers = request.headers();
  return {
    url: request.url(),
    headers: Object.fromEntries(["next-action", "content-type", "accept", "next-router-state-tree"].filter((name) => headers[name]).map((name) => [name, headers[name]])),
    body: request.postData() ?? "",
  };
}

const replay = (api: APIRequestContext, captured: Captured, body = captured.body, options: { maxRedirects?: number } = {}) =>
  api.post(captured.url, { headers: { ...captured.headers, origin: ORIGIN }, data: body, ...options });

test.describe("Business information", () => {
  test("is stored in the database, shown again after a reload, and shown to the same person on a fresh login", async ({ page, db, workerTenant, browser, clientAddresses }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Persisted Heating & Air");
    await page.getByLabel(/^Phone/).fill("512-555-0111");
    await page.getByLabel(/^Email/).fill("front.desk@persisted.test");
    await page.getByLabel(/^Street address/).fill("77 Mesquite Lane");
    await page.getByLabel(/^City/).fill("Round Rock");
    await page.getByLabel(/^ZIP code/).fill("78664");
    await save(page, "Save changes", "Business information saved.");

    const row = (await db.query("select name, phone, email, address_line1, city, state_region, postal_code from organizations where id = $1", [workerTenant.organizationId])).rows[0];
    expect(row).toEqual({ name: "Persisted Heating & Air", phone: "(512) 555-0111", email: "front.desk@persisted.test", address_line1: "77 Mesquite Lane", city: "Round Rock", state_region: "TX", postal_code: "78664" });

    await page.reload();
    await expect(page.getByLabel(/^Business name/)).toHaveValue("Persisted Heating & Air");
    await expect(page.getByLabel(/^Phone/)).toHaveValue("(512) 555-0111");

    const context = await browser.newContext({ storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const fresh = waitsForHydration(await context.newPage());
    await fresh.goto("/");
    await expect(fresh.getByTitle("Switch workspace")).toContainText("Persisted Heating & Air");
    await expect(fresh.getByRole("region", { name: "Business information" })).toContainText("77 Mesquite Lane");
    await context.close();
  });

  test("reaches the top bar, the Overview card and the sample pages that quote the business", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Everywhere Air");
    await save(page, "Save changes", "Business information saved.");
    await page.reload();
    await expect(page.getByTitle("Switch workspace")).toContainText("Everywhere Air");
    await page.goto("/");
    await expect(page.getByText("What needs your attention today at Everywhere Air.")).toBeVisible();
    await page.goto("/website/preview/contact");
    await expect(page.getByText("Everywhere Air").first()).toBeVisible();
  });

  test("a reload no longer restores the canonical record: the stored one wins", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Changed Name Co");
    await save(page, "Save changes", "Business information saved.");
    await page.reload();
    await expect(page.getByLabel(/^Business name/)).toHaveValue("Changed Name Co");
  });

  test("the screen is never ahead of the database: a save the server cannot take is reported, and the draft is kept", async ({ page, db, workerTenant, consoleGuard }) => {
    consoleGuard.allow(/ERR_FAILED/);
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Never Saved Heating");
    await page.route("**/settings", (route) => (route.request().headers()["next-action"] ? route.abort() : route.continue()));
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(formAlert(page)).toContainText("We couldn't reach the server, so nothing was saved.");
    await expect(page.getByLabel(/^Business name/)).toHaveValue("Never Saved Heating");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toBeVisible();
    await expect(page.getByTitle("Switch workspace")).toContainText(business.name);
    expect((await db.query("select name from organizations where id = $1", [workerTenant.organizationId])).rows[0].name).toBe(business.name);

    await page.unroute("**/settings");
    await save(page, "Save changes", "Business information saved.");
    await expect(page.locator("form [role='alert']")).toHaveCount(0);
    await expect(page.getByTitle("Switch workspace")).toContainText("Never Saved Heating");
  });

  test("shows that it is saving, and a double click sends one request", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Slow Save Heating");
    let sent = 0;
    await page.route("**/settings", async (route) => {
      if (route.request().headers()["next-action"]) {
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      await route.continue();
    });
    const button = page.getByRole("button", { name: "Save changes", exact: true });
    await button.dblclick();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(toast(page)).toContainText("Business information saved.");
    expect(sent).toBe(1);
  });
});

test.describe("Business hours", () => {
  test("are stored as seven rows, shown again after a reload, and the same everywhere that reads them", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/hours");
    await page.getByLabel("Monday opening time").selectOption("08:00");
    await page.getByLabel("Monday closing time").selectOption("17:00");
    await page.getByRole("button", { name: "Copy Monday to weekdays" }).click();
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await page.getByRole("switch", { name: "Sunday open" }).click();
    await save(page, "Save hours", "Business hours saved.");

    const rows = (await db.query("select day_of_week, is_open, to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes from organization_business_hours where organization_id = $1 order by day_of_week", [workerTenant.organizationId])).rows;
    expect(rows).toEqual([
      { day_of_week: 0, is_open: true, opens: "09:00", closes: "17:00" },
      ...[1, 2, 3, 4, 5].map((day) => ({ day_of_week: day, is_open: true, opens: "08:00", closes: "17:00" })),
      { day_of_week: 6, is_open: false, opens: null, closes: null },
    ]);

    await page.reload();
    await expect(page.getByLabel("Monday opening time")).toHaveValue("08:00");
    await expect(page.getByRole("switch", { name: "Saturday open" })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "Sunday open" })).toBeChecked();
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText("Mon–Fri: 8:00 AM–5:00 PM");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText("Sun: 9:00 AM–5:00 PM");
  });

  test("the saved hours decide which booking times are offered, after a full reload", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await page.getByRole("switch", { name: "Sunday open" }).click();
    await save(page, "Save hours", "Business hours saved.");

    await page.goto("/website/preview/booking/annual-cooling-tune-up");
    await page.getByLabel("Date", { exact: true }).fill("2024-10-26");
    await expect(page.getByText(/The business is closed on Sats\./)).toBeVisible();
    await page.getByLabel("Date", { exact: true }).fill("2024-10-27");
    await expect(page.getByRole("radio", { name: /^9:00 AM/ })).toBeEnabled();
  });

  test("a day that closes before it opens is refused by the server too, and nothing is stored", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/hours");
    await page.getByLabel("Tuesday closing time").selectOption("17:00");
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Save hours", exact: true }).click());
    await expect(toast(page)).toContainText("Business hours saved.");

    // The same call, with Tuesday closing at 05:00 (before it opens): the form would never send it, so send it by hand.
    const body = captured.body.replace(/"close":"17:00"/, '"close":"05:00"');
    expect(body).not.toBe(captured.body);
    const result = await replay(page.request, captured, body);
    expect(await result.text()).toContain("Closing time must be after opening time");
    const tuesday = (await db.query("select to_char(closes_at, 'HH24:MI') as closes from organization_business_hours where organization_id = $1 and day_of_week = 2", [workerTenant.organizationId])).rows[0];
    expect(tuesday.closes).toBe("17:00");
  });
});

test.describe("Workspace preferences", () => {
  test("are stored, applied from the stored copy after a reload, and leave currency as USD", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/preferences");
    await page.getByLabel("Time zone").selectOption("America/New_York");
    await page.getByLabel("Date format").selectOption("dmy-numeric");
    await page.getByRole("radio", { name: /^24-hour/ }).check();
    await save(page, "Save preferences", "Workspace preferences saved.");

    const row = (await db.query("select timezone, currency, date_format, time_format from organizations where id = $1", [workerTenant.organizationId])).rows[0];
    expect(row).toEqual({ timezone: "America/New_York", currency: "USD", date_format: "dmy-numeric", time_format: "24h" });

    await page.goto("/payments");
    await expect(page.getByRole("table", { name: "Payments" }).locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("28/10/2024");
    await page.goto("/schedule");
    await expect(page.getByText("Eastern Time (ET)")).toBeVisible();
    await expect(page.locator("#event-JB-204")).toContainText("10:00 – 12:00");
    await page.goto("/settings/preferences");
    await expect(page.getByLabel("Date format")).toHaveValue("dmy-numeric");
    await expect(page.getByRole("radio", { name: /^24-hour/ })).toBeChecked();
    await expect(page.getByLabel("Currency")).toHaveValue("USD — US Dollar ($)");
  });

  test("a value outside the allowed list is refused by the server and nothing is stored", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/preferences");
    await page.getByLabel("Date format").selectOption("ymd-iso");
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Save preferences", exact: true }).click());
    await expect(toast(page)).toContainText("Workspace preferences saved.");

    for (const [from, to] of [['"ymd-iso"', '"dd-mon-yy"'], ['"America/Chicago"', '"Mars/Olympus_Mons"'], ['"USD"', '"EUR"']]) {
      const body = captured.body.replace(from, to);
      expect(body, from).not.toBe(captured.body);
      const result = await (await replay(page.request, captured, body)).text();
      expect(result, to).toContain('"ok":false');
    }
    const row = (await db.query("select timezone, currency, date_format from organizations where id = $1", [workerTenant.organizationId])).rows[0];
    expect(row).toEqual({ timezone: "America/Chicago", currency: "USD", date_format: "ymd-iso" });
  });
});

test.describe("My profile", () => {
  test("the name is stored, shown in the top bar after a reload and in the account menu", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/profile");
    await page.getByLabel(/^Full name/).fill("Alexandra Morgan");
    await save(page, "Save profile", "Profile updated.");
    expect((await db.query("select full_name from profiles where user_id = $1", [workerTenant.userId])).rows[0].full_name).toBe("Alexandra Morgan");
    await page.reload();
    await expect(page.getByRole("button", { name: /Alexandra Morgan, Operations Lead/ })).toBeVisible();
    await expect(page.getByLabel(/^Full name/)).toHaveValue("Alexandra Morgan");
  });

  test("the role is shown, not edited, and the sign-in email is not a profile field", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/profile");
    await expect(page.getByText("Operations Lead").first()).toBeVisible();
    await expect(page.getByLabel(/^Email/)).toHaveCount(0);
    await expect(page.getByLabel(/^Role/)).toHaveCount(0);
    const membership = (await db.query("select role, job_title from organization_memberships where user_id = $1 and organization_id = $2", [workerTenant.userId, workerTenant.organizationId])).rows[0];
    expect(membership).toEqual({ role: "owner", job_title: "Operations Lead" });
  });

  test("a name that is too long is refused by the server and the stored name is kept", async ({ page, db, workerTenant }) => {
    await page.goto("/settings/profile");
    await page.getByLabel(/^Full name/).fill("Valid Name");
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Save profile", exact: true }).click());
    await expect(toast(page)).toContainText("Profile updated.");
    const result = await (await replay(page.request, captured, captured.body.replace("Valid Name", "x".repeat(200)))).text();
    expect(result).toContain('"ok":false');
    expect((await db.query("select full_name from profiles where user_id = $1", [workerTenant.userId])).rows[0].full_name).toBe("Valid Name");
  });
});

test.describe("the server decides who may change what", () => {
  test("a member replaying an owner's save is refused and Apex is unchanged", async ({ page, apiAs, db }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Owner Edit");
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Save changes", exact: true }).click());
    await expect(toast(page)).toContainText("Business information saved.");

    const jamie = await apiAs("jamie");
    const result = await (await replay(jamie, captured, captured.body.replace("Owner Edit", "Member Edit"))).text();
    expect(result).toContain("Only an owner or admin can change this workspace");
    const apex = (await db.query("select name from organizations where slug = 'apex-climate-heating-air'")).rows[0];
    expect(apex.name).toBe(business.name);
  });

  test("a request with no session cannot save anything", async ({ page, apiAs, db, workerTenant }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Owner Edit");
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Save changes", exact: true }).click());
    await expect(toast(page)).toContainText("Business information saved.");

    const anonymous = await apiAs(null);
    const response = await replay(anonymous, captured, captured.body.replace("Owner Edit", "Anonymous Edit"), { maxRedirects: 0 });
    expect([307, 401, 403]).toContain(response.status());
    const row = (await db.query("select name from organizations where id = $1", [workerTenant.organizationId])).rows[0];
    expect(row.name).toBe("Owner Edit");
  });

  test("naming another organization in the request changes nothing there: the server only ever writes to the caller's own active workspace", async ({ page, db, workerTenant, clientAddresses, playwright }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Owner Edit");
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Save changes", exact: true }).click());
    await expect(toast(page)).toContainText("Business information saved.");

    // Someone else's workspace: a second copy of the sample business with its own owner.
    const other = await ensureTestTenant(900 + test.info().parallelIndex);
    const otherState = await signInOverHttp(other.email, other.password, clientAddresses());
    const api = await playwright.request.newContext({ baseURL: ORIGIN, storageState: otherState, extraHTTPHeaders: { origin: ORIGIN } });
    const before = (await db.query("select name from organizations where id = $1", [workerTenant.organizationId])).rows[0].name;
    expect(before).toBe("Owner Edit");

    // Their payload names OUR organization explicitly, and a different business name.
    const forged = captured.body.replace("{", `{"organizationId":"${workerTenant.organizationId}","id":"${workerTenant.organizationId}",`).replace("Owner Edit", "Intruder Edit");
    await replay(api, captured, forged);
    await api.dispose();

    const mine = (await db.query("select name from organizations where id = $1", [workerTenant.organizationId])).rows[0].name;
    const theirs = (await db.query("select name from organizations where id = $1", [other.organizationId])).rows[0].name;
    expect(mine, "the named organization is untouched").toBe("Owner Edit");
    expect(theirs, "the caller's own workspace received the save").toBe("Intruder Edit");

    const { pool, db: admin } = adminDb();
    await resetTestTenant(admin, other);
    await pool.end();
  });
});

test.describe("branding is stored like the rest of Settings", () => {
  test("a saved accent is still there after a reload", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/settings/branding");
    await hydrated(page);
    await page.locator("#brand-accent").fill("#8B3A1E");
    await page.getByRole("button", { name: "Save branding", exact: true }).click();
    await expect(toast(page)).toContainText("Branding saved.");
    await page.reload();
    await expect(page.locator("#brand-accent")).toHaveValue("#8B3A1E");
    expect(problems).toEqual([]);
  });
});
