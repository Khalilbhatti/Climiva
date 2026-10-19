/**
 * Phase 19A, the console itself, driven in a browser as a platform administrator would use it: signing in, every page's real figures, search and
 * paging, the Marketplace moderation flow end to end (what the business and the public see afterwards), and the Server Action replayed by people
 * who must not be able to run it.
 */
import { randomBytes } from "node:crypto";
import { request } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { structuralIssues, unnamedControls } from "./a11y-lint";
import { anonymous, makeBusiness, ORIGIN, signedIn } from "./assets-helpers";
import { findLowContrast } from "./contrast";
import { captureAction, replay } from "./replay";
import { expect, signInOverHttp, test as base } from "./fixtures";
import { CONSOLE_PATHS, grantPlatformAdmin, makeAccount, makeListing, makePlatformAdmin, revokePlatformAdmin, type Account } from "./platform-admin-helpers";

const test = base.extend<object, { admin: Account }>({
  // One administrator per worker, signed in for every test unless a describe says otherwise.
  admin: [
    async ({}, use) => {
      const owner = adminDb();
      try {
        await use(await makePlatformAdmin("p19console", owner.db, owner.pool));
      } finally {
        await owner.pool.end();
      }
    },
    { scope: "worker" },
  ],
});
let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

// Every test here that is not about signing in starts as the worker's administrator.
test.beforeEach(async ({ context, admin, clientAddresses }, testInfo) => {
  if (testInfo.title.startsWith("[anonymous]")) return;
  const state = await signInOverHttp(admin.email, admin.password, clientAddresses());
  await context.addCookies(state.cookies);
});

const NO_SESSION = { cookies: [], origins: [] };

/* ───────────────────────────────── signing in ───────────────────────────────── */

test.describe("signing in", () => {
  test.use({ storageState: NO_SESSION });

  test("[anonymous] the console sends a visitor to the platform sign-in; an administrator signs in and lands on the overview, and signing out closes it", async ({ page, admin, consoleGuard }) => {
    consoleGuard.allow(/401|404/);
    await page.goto("/platform-admin/marketplace?q=x");
    await expect(page).toHaveURL(/\/platform-admin\/login$/);
    await expect(page.getByRole("heading", { name: "Platform sign-in" })).toBeVisible();
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);
    await expect(page.getByRole("heading", { name: "Platform overview", level: 1 })).toBeVisible();
    await expect(page.getByText(admin.email).first()).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/platform-admin\/login$/);
    await page.goto("/platform-admin/organizations");
    await expect(page).toHaveURL(/\/platform-admin\/login$/);
  });

  test("[anonymous] a workspace member who signs in here is told nothing and sees 'not found'", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/404|401/);
    const business = await makeBusiness("p19ui", owner.db);
    await page.goto("/platform-admin/login");
    await page.getByLabel("Email").fill(business.owner.email);
    await page.getByLabel("Password").fill(process.env.SEED_PASSWORD ?? "");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    // Nothing of the console, and nothing that says why.
    await expect(page.getByText(/administrator|permission|not allowed|forbidden/i)).toHaveCount(0);
  });

  test("[anonymous] a wrong password is the ordinary sign-in error, and an account that does not exist reads the same", async ({ page, admin, consoleGuard }) => {
    consoleGuard.allow(/401/);
    for (const email of [admin.email, `nobody-${randomBytes(3).toString("hex")}@example.test`]) {
      await page.goto("/platform-admin/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("Wrong-password-1");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByText("That email and password don't match")).toBeVisible();
      await expect(page).toHaveURL(/\/platform-admin\/login/);
    }
  });
});

/* ───────────────────────────────── overview ───────────────────────────────── */

const COUNTS: Record<string, string> = {
  Organizations: "select count(*)::int as n from organizations",
  Users: "select count(*)::int as n from auth_user",
  "Active memberships": "select count(*)::int as n from organization_memberships where status = 'active'",
  Sites: "select count(*)::int as n from sites",
  "Published sites": "select count(*)::int as n from sites where status = 'published' and published_version_id is not null",
  "Marketplace listings": "select count(*)::int as n from marketplace_listings",
  "Published listings": "select count(*)::int as n from marketplace_listings where status = 'published'",
  "Suspended listings": "select count(*)::int as n from platform_listing_moderation where state = 'suspended'",
  Bookings: "select count(*)::int as n from bookings",
  Reviews: "select count(*)::int as n from reviews",
};
const count = async (sql: string) => (await owner.pool.query(sql)).rows[0].n as number;

test("the overview shows the platform's real totals, with no trend or chart that has no data behind it", async ({ page }) => {
  // Other tests create and delete people and businesses while this one runs, so the totals are read from the database before the page is
  // asked for and again after it was shown; the figures on the page were counted in between. (An exact match is proved in
  // platform-admin-empty.spec.ts, on a database nothing else writes to.) The slack covers a test that adds and removes a few dozen rows inside the window.
  const before = Object.fromEntries(await Promise.all(Object.entries(COUNTS).map(async ([label, sql]) => [label, await count(sql)])));
  await page.goto("/platform-admin");
  await expect(page.getByRole("heading", { name: "Platform overview", level: 1 })).toBeVisible();
  const shown: Record<string, number> = {};
  for (const label of Object.keys(COUNTS)) {
    const text = await page.locator("main span", { hasText: new RegExp(`^${label}$`, "i") }).first().locator("xpath=../following-sibling::div[1]").innerText();
    shown[label] = Number(text.replace(/,/g, ""));
  }
  const after = Object.fromEntries(await Promise.all(Object.entries(COUNTS).map(async ([label, sql]) => [label, await count(sql)])));
  for (const label of Object.keys(COUNTS)) {
    expect(Number.isInteger(shown[label]), `${label} is a whole number`).toBe(true);
    expect(shown[label], label).toBeGreaterThanOrEqual(Math.min(before[label], after[label]) - 30);
    expect(shown[label], label).toBeLessThanOrEqual(Math.max(before[label], after[label]) + 30);
  }
  expect(shown.Users).toBeGreaterThan(1);
  // Only counts: no chart, no percentage-change, no "vs last month".
  await expect(page.locator("main svg[role='img'], main canvas")).toHaveCount(0);
  await expect(page.getByText(/vs\.? last|\+\d+%|-\d+%|trend/i)).toHaveCount(0);
});

/* ───────────────────────────────── organizations ───────────────────────────────── */

test.describe("organizations", () => {
  test("search by name, the columns, and the detail page of one business", async ({ page }) => {
    const business = await makeBusiness("p19orgui", owner.db);
    const suffix = business.slug.replace("p19orgui-", "");
    await makeListing(owner.pool, business.organizationId, "published");
    await page.goto("/platform-admin/organizations");
    await page.getByRole("searchbox", { name: "Search organizations by business name" }).fill(suffix.toUpperCase());
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${suffix.toUpperCase()}`));
    const row = page.getByRole("row", { name: new RegExp(business.slug) });
    await expect(row).toHaveCount(1);
    // Members 3, owners 1, Services (the Apex set), Sites 1, listing Published.
    const cells = (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim());
    expect(cells[2]).toBe("3");
    expect(cells[3]).toBe("1");
    expect(Number(cells[4])).toBe(await count(`select count(*)::int as n from services where organization_id = '${business.organizationId}'`));
    expect(cells[5]).toMatch(/^1/);
    expect(cells[6]).toContain("Published");

    await row.getByRole("link", { name: new RegExp(`Logo Test p19orgui ${suffix}`) }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Logo Test p19orgui ${suffix}`), level: 1 })).toBeVisible();
    for (const person of [business.owner, business.admin, business.member]) await expect(page.getByText(person.email)).toBeVisible();
    await expect(page.getByText("Business profile")).toBeVisible();
    await expect(page.getByText("Marketplace listing").first()).toBeVisible();
    // Read-only, and no way to become the business.
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.getByText(/impersonat|log in as|sign in as|view as|switch to this business/i)).toHaveCount(0);
  });

  test("no match is a clear empty state, and a long list pages with the search kept", async ({ page }) => {
    const marker = randomBytes(3).toString("hex");
    await owner.pool.query("insert into organizations (name, slug, timezone) select 'P19 page ' || $1 || ' ' || lpad(n::text, 2, '0'), 'p19-page-' || $1 || '-' || n, 'America/Denver' from generate_series(1, 27) as n", [marker]);
    try {
      await page.goto(`/platform-admin/organizations?q=${marker}`);
      await expect(page.getByRole("row", { name: /P19 page/ })).toHaveCount(25);
      await expect(page.getByText("Showing 1–25 of 27")).toBeVisible();
      await page.getByRole("link", { name: "Next" }).click();
      await expect(page).toHaveURL(new RegExp(`q=${marker}&page=2|page=2&q=${marker}`));
      await expect(page.getByRole("row", { name: /P19 page/ })).toHaveCount(2);
      await expect(page.getByText("Showing 26–27 of 27")).toBeVisible();
      await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);
      await page.getByRole("link", { name: "Previous" }).click();
      await expect(page.getByText("Showing 1–25 of 27")).toBeVisible();
      // A page far past the end is the last page of the same list, not an error and not "no match".
      await page.goto(`/platform-admin/organizations?q=${marker}&page=9999`);
      await expect(page.getByText("Showing 26–27 of 27")).toBeVisible();
      await expect(page.getByRole("row", { name: /P19 page/ })).toHaveCount(2);

      await page.goto(`/platform-admin/organizations?q=${marker}-no-such-business`);
      await expect(page.getByRole("heading", { name: "No organization matches that name" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Clear" })).toBeVisible();
    } finally {
      await owner.pool.query("delete from organizations where slug like $1", [`p19-page-${marker}-%`]);
    }
  });
});

/* ───────────────────────────────── users ───────────────────────────────── */

test("users: identity, businesses and roles, and which accounts are administrators; no secret on the page", async ({ page, admin }) => {
  const business = await makeBusiness("p19userui", owner.db);
  await page.goto(`/platform-admin/users?q=${encodeURIComponent(business.owner.email.toUpperCase())}`);
  const row = page.getByRole("row", { name: new RegExp(business.owner.email) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("owner");
  await expect(row).toContainText(`Logo Test p19userui`);
  await expect(row.getByText("Super administrator")).toHaveCount(0);

  await page.goto(`/platform-admin/users?q=${encodeURIComponent(admin.email)}`);
  await expect(page.getByRole("row", { name: new RegExp(admin.email) }).getByText("Super administrator")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(admin.email) })).toContainText("No business");

  // No password, session, token or recovery material, whatever the page lists.
  await page.goto("/platform-admin/users");
  const html = await page.content();
  const secrets = await owner.pool.query<{ secret: string }>("select password as secret from auth_account where password is not null union all select token from auth_session union all select value from auth_verification");
  for (const { secret } of secrets.rows) expect(html).not.toContain(secret);
  expect(html).not.toMatch(/"(password|token|accessToken|refreshToken|idToken|secret)"\s*:/i);
  await expect(page.getByText(/change password|reset password|set password/i)).toHaveCount(0);
  // Searching with wildcard characters finds only what contains them.
  await page.goto("/platform-admin/users?q=%25_%25");
  await expect(page.getByText(/No user matches that search|Showing/)).toBeVisible();
});

/* ───────────────────────────────── marketplace moderation ───────────────────────────────── */

test.describe("marketplace moderation", () => {
  const publicStatus = async (slug: string) => {
    const api = await anonymous(`fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`);
    try {
      return (await api.get(`/listings/${slug}`, { maxRedirects: 0 })).status();
    } finally {
      await api.dispose();
    }
  };
  const moderation = async (id: string) => (await owner.pool.query("select state, reason from platform_listing_moderation where listing_id = $1", [id])).rows[0] ?? null;
  const events = async (id: string) => (await owner.pool.query("select action from platform_audit_events where target_id = $1 order by occurred_at, id", [id])).rows.map((row) => row.action as string);

  test("suspend with an internal reason, see it stop being public, keep the business's own data, then allow it again", async ({ page, admin }) => {
    const business = await makeBusiness("p19modui", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    const before = (await owner.pool.query("select status, description, cover, updated_at from marketplace_listings where id = $1", [listing.id])).rows[0];
    expect(await publicStatus(listing.slug)).toBe(200);

    await page.goto(`/platform-admin/marketplace?q=${listing.slug}`);
    const row = page.getByRole("row", { name: new RegExp(listing.slug) });
    await expect(row).toContainText("Allowed");
    await expect(row).toContainText("Available");
    await row.getByText("Suspend…").click();
    const reason = `Internal note ${randomBytes(3).toString("hex")}: licence number not verified`;
    await row.getByLabel("Internal reason (optional)").fill(reason);
    await row.getByRole("button", { name: "Suspend listing" }).click();

    await expect(page.getByRole("status")).toContainText("The listing is suspended");
    await expect(page).toHaveURL(/notice=suspended/);
    const after = page.getByRole("row", { name: new RegExp(listing.slug) });
    await expect(after).toContainText("Suspended");
    await expect(after).toContainText("Not available");
    await expect(after).toContainText(reason);
    await expect(after).toContainText("Published"); // what the business chose is unchanged
    expect(await moderation(listing.id)).toEqual({ state: "suspended", reason });
    expect(await events(listing.id)).toEqual(["marketplace_listing.suspended"]);
    expect((await owner.pool.query("select actor_label from platform_audit_events where target_id = $1", [listing.id])).rows[0].actor_label).toBe(admin.email);

    // The public sees the same as an address that does not exist; the business's own record is untouched; the reason is shown to nobody else.
    expect(await publicStatus(listing.slug)).toBe(404);
    expect((await owner.pool.query("select status, description, cover, updated_at from marketplace_listings where id = $1", [listing.id])).rows[0]).toEqual(before);
    const ownerApi = await signedIn(business.owner.email, `fd00:${randomBytes(2).toString("hex")}:9::1`);
    try {
      for (const path of ["/marketplace", "/marketplace/edit", "/website", "/"]) {
        const response = await ownerApi.get(path, { maxRedirects: 0 });
        expect(response.status(), path).toBe(200);
        expect(await response.text(), path).not.toContain(reason);
      }
    } finally {
      await ownerApi.dispose();
    }

    await page.getByRole("row", { name: new RegExp(listing.slug) }).getByRole("button", { name: "Allow again" }).click();
    await expect(page.getByRole("status")).toContainText("The listing is allowed again");
    await expect(page.getByRole("row", { name: new RegExp(listing.slug) })).toContainText("Allowed");
    expect(await moderation(listing.id)).toEqual({ state: "allowed", reason: null });
    expect(await events(listing.id)).toEqual(["marketplace_listing.suspended", "marketplace_listing.unsuspended"]);
    expect(await publicStatus(listing.slug)).toBe(200);
  });

  test("a hidden listing stays unavailable when allowed, an unpublished one cannot be made public by the platform, and the table says why", async ({ page }) => {
    const business = await makeBusiness("p19modhid", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "hidden");
    await page.goto(`/platform-admin/marketplace?q=${listing.slug}`);
    const row = page.getByRole("row", { name: new RegExp(listing.slug) });
    await expect(row).toContainText("Hidden");
    await expect(row).toContainText("Allowed");
    await expect(row).toContainText("Not available");
    expect(await publicStatus(listing.slug)).toBe(404);
    // Suspend, then allow: the business never published it, so it is still not public.
    await row.getByText("Suspend…").click();
    await row.getByRole("button", { name: "Suspend listing" }).click();
    await expect(page.getByRole("status")).toContainText("suspended");
    await page.getByRole("row", { name: new RegExp(listing.slug) }).getByRole("button", { name: "Allow again" }).click();
    await expect(page.getByRole("row", { name: new RegExp(listing.slug) })).toContainText("Not available");
    expect(await publicStatus(listing.slug)).toBe(404);
  });

  test("an over-long reason is refused with nothing changed, and a return address outside the console is ignored", async ({ page }) => {
    const business = await makeBusiness("p19modlong", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    await page.goto(`/platform-admin/marketplace?q=${listing.slug}`);
    const row = page.getByRole("row", { name: new RegExp(listing.slug) });
    await row.getByText("Suspend…").click();
    // The textarea stops typing at 500; take the limit away to send what a script could.
    await row.locator("textarea").evaluate((element: HTMLTextAreaElement) => element.removeAttribute("maxlength"));
    await row.locator("textarea").fill("x".repeat(501));
    await row.getByRole("button", { name: "Suspend listing" }).click();
    await expect(page.getByRole("status")).toContainText("longer than 500 characters");
    expect(await moderation(listing.id)).toBeNull();
    expect(await events(listing.id)).toEqual([]);
    expect(await publicStatus(listing.slug)).toBe(200);
  });

  test("the Server Action does nothing for anyone but a current platform administrator: no session, a business owner, a revoked administrator", async ({ page }) => {
    const business = await makeBusiness("p19modreplay", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    await page.goto(`/platform-admin/marketplace?q=${listing.slug}`);
    const row = page.getByRole("row", { name: new RegExp(listing.slug) });
    await row.getByText("Suspend…").click();
    const captured = await captureAction(page, () => row.getByRole("button", { name: "Suspend listing" }).click());
    await expect(page.getByRole("status")).toContainText("suspended");
    // Put it back so the replays have something to do.
    await page.getByRole("row", { name: new RegExp(listing.slug) }).getByRole("button", { name: "Allow again" }).click();
    await expect(page.getByRole("status")).toContainText("allowed again");
    const baseline = await events(listing.id);
    expect(baseline).toHaveLength(2);

    const attempts: { who: string; api: Awaited<ReturnType<typeof signedIn>> }[] = [
      { who: "no session", api: await anonymous(`fd00:${randomBytes(2).toString("hex")}:a::1`) },
      { who: "business owner", api: await signedIn(business.owner.email, `fd00:${randomBytes(2).toString("hex")}:b::1`) },
      { who: "business admin", api: await signedIn(business.admin.email, `fd00:${randomBytes(2).toString("hex")}:c::1`) },
    ];
    const revoked = await makePlatformAdminAndRevoke();
    attempts.push({ who: "revoked administrator", api: await signedIn(revoked.email, `fd00:${randomBytes(2).toString("hex")}:d::1`) });
    try {
      for (const attempt of attempts) {
        const response = await replay(attempt.api, captured, captured.body, { maxRedirects: 0 });
        expect(response.status(), attempt.who).toBeLessThan(500);
        expect(await moderation(listing.id), attempt.who).toEqual({ state: "allowed", reason: null });
        expect(await events(listing.id), attempt.who).toEqual(baseline);
        expect(await publicStatus(listing.slug), attempt.who).toBe(200);
      }
      // The same call, with the listing changed to one that does not exist, or the state to one that is not a state: a notice, not an error.
      const ghost = captured.body.replace(listing.id, "00000000-0000-4000-8000-000000000000");
      expect(ghost).not.toBe(captured.body);
      const adminApi = await request.newContext({ baseURL: ORIGIN, storageState: await page.context().storageState(), extraHTTPHeaders: { origin: ORIGIN } });
      try {
        const missing = await replay(adminApi, captured, ghost, { maxRedirects: 0 });
        expect(missing.status()).toBeLessThan(500);
        const invalid = await replay(adminApi, captured, captured.body.replace("suspended", "deleted"), { maxRedirects: 0 });
        expect(invalid.status()).toBeLessThan(500);
        expect(await events(listing.id)).toEqual(baseline);
        expect(await publicStatus(listing.slug)).toBe(200);
        // The control: the very same request, from the administrator, does what it says. So the refusals above were refusals, not a broken replay.
        const applied = await replay(adminApi, captured, captured.body, { maxRedirects: 0 });
        expect(applied.status()).toBeLessThan(500);
        expect(await moderation(listing.id)).toMatchObject({ state: "suspended" });
        expect(await events(listing.id)).toEqual([...baseline, "marketplace_listing.suspended"]);
        expect(await publicStatus(listing.slug)).toBe(404);
      } finally {
        await adminApi.dispose();
      }
    } finally {
      for (const attempt of attempts) await attempt.api.dispose();
    }
  });
});

async function makePlatformAdminAndRevoke(): Promise<Account> {
  const account = await makeAccount("p19revoked", owner.db);
  await grantPlatformAdmin(owner.pool, account.userId);
  await revokePlatformAdmin(owner.pool, account.userId);
  return account;
}

/* ───────────────────────────────── reviews, system ───────────────────────────────── */

test("reviews are read across the platform and cannot be changed from here", async ({ page }) => {
  await page.goto("/platform-admin/reviews");
  await expect(page.getByRole("heading", { name: /Reviews/, level: 1 })).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
  // Read-only: no control changes a review; the page says moderation of public reviews is a later step.
  await expect(page.getByRole("button", { name: /hide|remove|delete|approve|reject|suspend|respond|reply/i })).toHaveCount(0);
  await expect(page.getByText(/arrives together with public reviews/)).toBeVisible();
  // The rating filter.
  await page.goto("/platform-admin/reviews?rating=5");
  const rows = page.getByRole("row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(1);
  for (const text of await page.locator("tbody tr").allInnerTexts()) expect(text).toMatch(/5/);
  // A rating that is not one of the five is ignored, like any unknown filter: the page lists reviews, it does not fail.
  const unfiltered = await page.goto("/platform-admin/reviews?rating=9");
  expect(unfiltered?.status()).toBe(200);
  await expect(page.getByRole("table", { name: "Reviews" })).toBeVisible();
  // A search that matches nothing is the empty state.
  await page.goto(`/platform-admin/reviews?q=${randomBytes(6).toString("hex")}-no-such-words`);
  await expect(page.getByRole("heading", { name: "No review matches those filters" })).toBeVisible();
});

test("system shows safe facts and no secret", async ({ page }) => {
  await page.goto("/platform-admin/system");
  await expect(page.getByRole("heading", { name: "System", level: 1 })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).toMatch(/Environment/i);
  expect(text).toMatch(/PostgreSQL \d/);
  expect(text).toMatch(/Migrations applied/i);
  expect(text).toMatch(/Asset storage driver\s*local/i); // the driver's NAME, nothing about where it keeps files
  const html = await page.content();
  const secrets = [process.env.DATABASE_URL, process.env.DATABASE_ADMIN_URL, process.env.SEED_PASSWORD, process.env.TLS_ASK_TOKEN, process.env.BETTER_AUTH_SECRET, process.env.POSTGRES_APP_PASSWORD, process.env.POSTGRES_PASSWORD];
  for (const secret of secrets) if (secret && secret.length >= 8) expect(html, `a configured secret (${secret.slice(0, 3)}…)`).not.toContain(secret);
  expect(html).not.toMatch(/postgres(ql)?:\/\/|AKIA[0-9A-Z]{12,}|aws_secret|BEGIN [A-Z ]*PRIVATE KEY/i);
  // Domain ownership tokens are never printed.
  const tokens = await owner.pool.query<{ verification_token: string }>("select verification_token from site_domains limit 50");
  for (const { verification_token } of tokens.rows) expect(html).not.toContain(verification_token);
  // The audit trail is shown with who did what.
  await expect(page.getByText("Recent platform activity", { exact: true })).toBeVisible();
});

/* ───────────────────────────────── layout and accessibility ───────────────────────────────── */

test.describe("every console page", () => {
  const PATHS = [...CONSOLE_PATHS, "/platform-admin/organizations?q=zzzz-no-such", "/platform-admin/marketplace?q=zzzz-no-such"];
  for (const path of PATHS) {
    test(`${path} passes the structural, name and contrast checks, and has no console messages`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
      expect((await page.title()).trim().length).toBeGreaterThan(0);
      expect(await unnamedControls(page), "controls without a name").toEqual([]);
      expect(await structuralIssues(page), "structure").toEqual([]);
      expect(await findLowContrast(page), "contrast").toEqual([]);
      await expect(page.getByRole("navigation", { name: "Platform" }).getByRole("link")).toHaveCount(6);
      await expect(page.locator("main#platform-main")).toBeVisible();
    });

    test(`${path} fits a phone without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test("the navigation marks the current page and the skip link reaches the content", async ({ page }) => {
    await page.goto("/platform-admin/users");
    await expect(page.getByRole("navigation", { name: "Platform" }).locator('a[aria-current="page"]')).toHaveText(/Users/);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#platform-main$/);
  });

  test("the six sections, in order, are the whole navigation: Overview, Organizations, Users, Marketplace Listings, Reviews / Moderation, System", async ({ page }) => {
    await page.goto("/platform-admin");
    const labels = await page.getByRole("navigation", { name: "Platform" }).getByRole("link").allInnerTexts();
    expect(labels.map((label) => label.trim())).toEqual(["Overview", "Organizations", "Users", "Marketplace Listings", "Reviews / Moderation", "System"]);
  });
});
