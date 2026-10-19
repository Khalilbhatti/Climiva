/**
 * Docker side, part 5: the platform console in the production-shaped stack.
 *
 *   - a new deployment has no platform administrator, and an ordinary person who signs up is not one;
 *   - the first administrator is granted by the command-line tool that ships in the TOOLS image (`docker compose run --rm migrate ...`), to an
 *     account that already exists, and never to an unknown address;
 *   - that person signs in at /platform-admin/login through the proxy and uses the console; the application's own database role, in the real
 *     container, can not touch the platform tables;
 *   - revoking takes the access away at once, keeps the account, and every step is in the audit trail;
 *   - the console shows the environment as a production deployment and none of the stack's secrets.
 *
 * It signs its own person up, so it can run after 02 (when a business exists) or on its own on a new database.
 */
import { expect, test, type BrowserContext, type Page } from "playwright/test";
import { completeOnboarding, PASSWORD, signUp, waitsForHydration } from "../e2e/saas";
import { compose, composeResult, get, one, sql, stack } from "./stack";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let email = "";

const grant = (address: string) => composeResult("run", "--rm", "migrate", "npm", "run", "platform-admin:grant", "--", "--email", address);
const revoke = (address: string) => composeResult("run", "--rm", "migrate", "npm", "run", "platform-admin:revoke", "--", "--email", address);

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: stack.origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  page = waitsForHydration(await context.newPage());
});
test.afterAll(async () => {
  await context.close();
});

test("a new deployment has no platform administrator, and the tables are closed to the application's own role", async () => {
  expect(Number(one("select count(*) from platform_admins"))).toBe(0);
  expect(Number(one("select count(*) from platform_audit_events"))).toBe(0);
  expect(Number(one("select count(*) from platform_listing_moderation"))).toBe(0);
  // Asked from inside the real application container, with its own connection: the restricted role has no privilege on the three tables, and the
  // function that answers "is this person an administrator" says no to a caller who has said nobody.
  const answer = compose(
    "exec", "-T", "app", "node", "-e",
    `const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1});(async()=>{const out={};for(const t of ['platform_admins','platform_listing_moderation','platform_audit_events']){try{await p.query('select count(*) from '+t);out[t]='read'}catch(e){out[t]=e.code}}const r=await p.query('select app_is_platform_admin() as a');out.anonymous=r.rows[0].a;try{await p.query('select app_platform_overview()');out.overview='ran'}catch(e){out.overview=e.code}console.log(JSON.stringify(out));await p.end()})()`,
  );
  expect(JSON.parse(answer.trim())).toEqual({ platform_admins: "42501", platform_listing_moderation: "42501", platform_audit_events: "42501", anonymous: false, overview: "42501" });
});

test("a person who signs up is an ordinary account: the console is closed to them", async () => {
  email = await signUp(page, { name: "Console Candidate" });
  expect(Number(one(`select count(*) from platform_admins a join auth_user u on u.id = a.user_id where u.email = '${email}'`))).toBe(0);
  // Closed to the anonymous (sign-in) and to the signed-in who are not administrators ("not found").
  const anonymous = await get(stack.publicHost, "/platform-admin");
  expect(anonymous.status).toBe(307);
  expect(String(anonymous.headers.location)).toContain("/platform-admin/login");
  const response = await page.goto("/platform-admin");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
});

test("the tool in the tools image grants an existing account, and refuses an address that has none", async () => {
  const unknown = grant("nobody-at-all@example.test");
  expect(unknown.code).not.toBe(0);
  expect(unknown.out).toContain("No account has that email address");
  expect(Number(one("select count(*) from platform_admins"))).toBe(0);
  expect(Number(one("select count(*) from auth_user where email = 'nobody-at-all@example.test'"))).toBe(0);

  const granted = grant(email);
  expect(granted.code, granted.out).toBe(0);
  expect(granted.out).toContain("Granted");
  expect(granted.out).not.toContain(PASSWORD);
  // Again: nothing changes.
  const again = grant(email);
  expect(again.code, again.out).toBe(0);
  expect(again.out).toContain("Nothing changed");
  expect(sql(`select a.role, a.granted_via, a.granted_by like 'cli:%' from platform_admins a join auth_user u on u.id = a.user_id where u.email = '${email}' and a.revoked_at is null`)).toEqual([["super_admin", "cli", "t"]]);
  expect(sql("select action, actor_kind from platform_audit_events order by occurred_at")).toEqual([["platform_admin.granted", "cli"]]);
  const listed = composeResult("run", "--rm", "migrate", "npm", "run", "platform-admin:list");
  expect(listed.out).toContain(email);
});

test("the administrator signs in at the platform sign-in through the proxy and uses every page", async () => {
  // A fresh browser session, as someone arriving at the console's address.
  const fresh = await context.browser()!.newContext({ baseURL: stack.origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const admin = waitsForHydration(await fresh.newPage());
  try {
    await admin.goto("/platform-admin/organizations");
    await expect(admin).toHaveURL(/\/platform-admin\/login$/);
    await admin.getByLabel("Email").fill(email);
    await admin.getByLabel("Password").fill(PASSWORD);
    await admin.getByRole("button", { name: "Log in" }).click();
    await expect(admin).toHaveURL(/\/platform-admin$/);
    await expect(admin.getByRole("heading", { name: "Platform overview", level: 1 })).toBeVisible();
    await expect(admin.getByRole("navigation", { name: "Platform" }).getByRole("link")).toHaveCount(6);

    const problems: string[] = [];
    admin.on("pageerror", (error) => problems.push(error.message));
    for (const path of ["/platform-admin", "/platform-admin/organizations", "/platform-admin/users", "/platform-admin/marketplace", "/platform-admin/reviews", "/platform-admin/system"]) {
      const response = await admin.goto(path);
      expect(response?.status(), path).toBe(200);
      expect(response?.headers()["cache-control"], path).toMatch(/no-store|no-cache|private/);
      await expect(admin.locator("main"), path).toBeVisible();
      await expect(admin.locator("body"), path).not.toContainText(/Application error|Internal Server Error|Something went wrong/i);
    }
    expect(problems).toEqual([]);

    // The figures are the database's own.
    await admin.goto("/platform-admin");
    const shown = async (label: string) => Number((await admin.locator("main span", { hasText: new RegExp(`^${label}$`, "i") }).first().locator("xpath=../following-sibling::div[1]").innerText()).replace(/,/g, ""));
    expect(await shown("Users")).toBe(Number(one("select count(*) from auth_user")));
    expect(await shown("Organizations")).toBe(Number(one("select count(*) from organizations")));
    expect(await shown("Marketplace listings")).toBe(Number(one("select count(*) from marketplace_listings")));

    // The people list shows this administrator, who has no business, and no secret.
    await admin.goto(`/platform-admin/users?q=${encodeURIComponent(email)}`);
    const row = admin.getByRole("row", { name: new RegExp(email) });
    await expect(row).toContainText("Super administrator");
    await expect(row).toContainText("No business");

    // System: a production deployment, a ready stack, the storage driver's name, and none of the stack's secrets.
    await admin.goto("/platform-admin/system");
    const main = await admin.locator("main").innerText();
    expect(main).toMatch(/Production deployment/);
    expect(main).toMatch(/Asset storage driver\s*local/i);
    expect(main).toMatch(/PostgreSQL 17/);
    expect(main).toMatch(/Migrations applied\s*\d+/);
    expect(main).toContain("Platform administrator granted");
    const html = await admin.content();
    for (const name of ["POSTGRES_PASSWORD", "POSTGRES_APP_PASSWORD", "POSTGRES_OWNER_PASSWORD", "BETTER_AUTH_SECRET", "TLS_ASK_TOKEN", "DATABASE_URL", "DATABASE_ADMIN_URL"]) {
      const value = stack.env[name];
      if (value && value.length >= 8) expect(html, name).not.toContain(value);
    }
    expect(html).not.toMatch(/postgres(ql)?:\/\//i);

    // Revoked from the command line: the very same session is turned away on its next request, and the account is still there.
    const revoked = revoke(email);
    expect(revoked.code, revoked.out).toBe(0);
    expect(revoked.out).toContain("Revoked");
    const after = await admin.goto("/platform-admin");
    expect(after?.status()).toBe(404);
    expect(Number(one(`select count(*) from auth_user where email = '${email}'`))).toBe(1);
    expect(sql(`select (a.revoked_at is not null), a.revoked_by like 'cli:%' from platform_admins a join auth_user u on u.id = a.user_id where u.email = '${email}'`)).toEqual([["t", "t"]]);
    expect(sql("select action from platform_audit_events order by occurred_at")).toEqual([["platform_admin.granted"], ["platform_admin.revoked"]]);
  } finally {
    await fresh.close();
  }
});

test("the person still signs in to their own workspace, which the console never touched", async () => {
  // Granted and revoked leave the account as it was: onboarding is still what they see, and they can still set a business up.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/onboarding$/);
  await completeOnboarding(page, { name: "Console Candidate Heating" });
  expect(sql(`select m.role from organization_memberships m join auth_user u on u.id = m.user_id where u.email = '${email}'`)).toEqual([["owner"]]);
  // Being a business owner gave no console access.
  const response = await page.goto("/platform-admin");
  expect(response?.status()).toBe(404);
});
