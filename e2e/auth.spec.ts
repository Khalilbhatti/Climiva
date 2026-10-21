/**
 * Accounts and sessions: signing up, logging in and out, who is turned away, and what happens when a session ends.
 */
import { expect, expectAccessible, formAlert, hydrated, newEmail, NOT_SIGNED_IN, openForm, ORIGIN, PASSWORD, SEED, SEED_PASSWORD, signUp, test, waitsForHydration } from "./saas";
import { signInOverHttp } from "./fixtures";
import { ROUTE_INVENTORY } from "./route-inventory";

test.describe("signed out", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("the workspace address sends a visitor to Log in, and the front door is the public landing", async ({ page }) => {
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login\?next=%2Foverview$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Find HVAC service. Run the business behind it." })).toBeVisible();
  });

  test("a deep link goes to Log in and remembers where it was going", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell?tab=notes");
    await expect(page).toHaveURL(/\/login\?next=%2Fcustomers%2Fsarah-mitchell%3Ftab%3Dnotes$/);
  });

  test("every workspace route redirects a visitor to Log in without rendering any of it", async ({ apiAs }) => {
    const api = await apiAs(null);
    const routes = ROUTE_INVENTORY.filter((route) => route.shell).map((route) => route.url);
    expect(routes.length).toBeGreaterThan(100);
    const leaks: string[] = [];
    for (const url of routes) {
      const response = await api.get(url, { maxRedirects: 0 });
      const location = response.headers().location ?? "";
      if (response.status() !== 307 || !location.includes("/login")) leaks.push(`${url}: ${response.status()} ${location}`);
      if (/Apex|Sarah Mitchell/.test(await response.text())) leaks.push(`${url}: body mentions the sample business`);
    }
    expect(leaks).toEqual([]);
  });

  test("the Draft previews are for people signed in to the business: a visitor is sent to Log in and sees none of it", async ({ apiAs }) => {
    const api = await apiAs(null);
    for (const path of ["/website/preview", "/website/preview/services", "/website/preview/booking/annual-cooling-tune-up", "/marketplace-listing/preview"]) {
      const response = await api.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers().location ?? "", path).toContain("/login");
      expect(await response.text(), path).not.toMatch(/Apex|Sarah Mitchell/);
    }
  });

  test("a published website and a published listing are public: they are served to a visitor, and only what they publish", async ({ apiAs }) => {
    const api = await apiAs(null);
    for (const path of ["/sites/apexclimate", "/sites/apexclimate/services", "/listings/apex-climate-heating-air"]) {
      const response = await api.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).not.toMatch(/Sarah Mitchell|internal notes/i);
    }
  });

  test("an unknown address does not reveal a workspace either: a visitor is sent to Log in", async ({ page }) => {
    await page.goto("/definitely-not-a-page");
    await expect(page).toHaveURL(/\/login\?next=%2Fdefinitely-not-a-page$/);
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByText("Apex")).toHaveCount(0);
  });

  test("Log in and Sign up are reachable from each other and have one h1 and labelled fields", async ({ page }) => {
    await openForm(page, "/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByLabel(/^Email/)).toBeVisible();
    await expect(page.getByLabel(/^Password/)).toBeVisible();
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
    for (const label of [/^Full name/, /^Email/, /^Password/]) await expect(page.getByLabel(label)).toBeVisible();
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  for (const path of ["/login", "/signup", "/login?next=%2Fsettings"]) {
    test(`${path} passes the structural and contrast checks`, async ({ page }) => {
      await openForm(page, path);
      await expectAccessible(page);
    });
  }

  test("the Log in and Sign up pages stay accessible with their errors showing", async ({ page }) => {
    await openForm(page, "/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expectAccessible(page);
    await openForm(page, "/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expectAccessible(page);
  });

  test("Log in checks the form before it asks the server", async ({ page }) => {
    await openForm(page, "/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.getByLabel(/^Email/)).toBeFocused();
    await page.getByLabel(/^Email/).fill("not-an-email");
    await page.getByLabel(/^Password/).fill("x");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
  });

  test("a wrong password and an unknown email get the same message, so accounts cannot be probed", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/401|Unauthorized/);
    await openForm(page, "/login");
    await page.getByLabel(/^Email/).fill(SEED.alex);
    await page.getByLabel(/^Password/).fill("wrong-password-1");
    await page.getByRole("button", { name: "Log in" }).click();
    const message = formAlert(page);
    await expect(message).toHaveText("That email and password don't match. Check them and try again.");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel(/^Email/).fill(newEmail("nobody"));
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(message).toHaveText("That email and password don't match. Check them and try again.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logging in opens the person's workspace, with a session cookie the page's scripts cannot read", async ({ page, context }) => {
    await openForm(page, "/login");
    await page.getByLabel(/^Email/).fill(SEED.alex);
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByTitle("Switch workspace")).toContainText("Apex Climate Heating & Air");
    const session = (await context.cookies()).find((cookie) => cookie.name.endsWith("session_token"));
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
  });

  test("after logging in the person returns to the page they asked for", async ({ page }) => {
    await page.goto("/settings/hours");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fhours$/);
    await hydrated(page);
    await page.getByLabel(/^Email/).fill(SEED.alex);
    await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/settings\/hours$/);
    await expect(page.getByRole("heading", { level: 2, name: "Business hours" })).toBeVisible();
  });

  for (const target of ["https://evil.example/steal", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
    test(`a "next" address that leaves the site is ignored: ${target}`, async ({ page }) => {
      await openForm(page, `/login?next=${encodeURIComponent(target)}`);
      await page.getByLabel(/^Email/).fill(SEED.alex);
      await page.getByLabel(/^Password/).fill(SEED_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      expect(new URL(page.url()).origin).toBe(ORIGIN);
    });
  }

  test("Sign up checks each field", async ({ page }) => {
    await openForm(page, "/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters.", { exact: true }).last()).toBeVisible();
    await expect(page.getByLabel(/^Full name/)).toBeFocused();
  });

  test("a password under eight characters is refused", async ({ page }) => {
    await openForm(page, "/signup");
    await page.getByLabel(/^Full name/).fill("Short Pass");
    await page.getByLabel(/^Email/).fill(newEmail("short"));
    await page.getByLabel(/^Password/).fill("1234567");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 8 characters.", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("an email that already has an account is refused with a way back to Log in", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/422|Unprocessable|40\d/);
    await openForm(page, "/signup");
    await page.getByLabel(/^Full name/).fill("Alex Again");
    await page.getByLabel(/^Email/).fill(SEED.alex);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(formAlert(page)).toContainText("An account with that email already exists. Log in instead.");
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("signing up creates the account and its profile, signs the person in and starts set-up; no business exists yet", async ({ page, db }) => {
    const email = await signUp(page, { name: "Riley Fresh" });
    await expect(page.getByRole("heading", { level: 1, name: "Set up your business" })).toBeVisible();
    const user = await db.query<{ id: string; name: string }>("select id, name from auth_user where email = $1", [email]);
    expect(user.rows[0].name).toBe("Riley Fresh");
    const profile = await db.query("select full_name from profiles where user_id = $1", [user.rows[0].id]);
    expect(profile.rows[0].full_name).toBe("Riley Fresh");
    const memberships = await db.query("select 1 from organization_memberships where user_id = $1", [user.rows[0].id]);
    expect(memberships.rowCount).toBe(0);
    // Their password is stored hashed by Better Auth, never as typed.
    const account = await db.query<{ password: string }>("select password from auth_account where user_id = $1", [user.rows[0].id]);
    expect(account.rows[0].password).not.toContain(PASSWORD);
  });

  test("someone who is signed in but has no business cannot open the workspace; they are sent to set one up", async ({ page }) => {
    await signUp(page);
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test.describe("signed in", () => {
  test("an unknown address is a not-found page inside the person's own workspace", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/404/);
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  test("visiting Log in or Sign up while signed in goes on to the workspace", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/overview$/);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });

  test("Log out ends the session in the database, clears the cookie and closes every workspace page", async ({ browser, workerTenant, clientAddresses, db }) => {
    // A session of its own, so ending it does not sign the rest of this worker's tests out.
    const storageState = await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses());
    const context = await browser.newContext({ storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    const token = decodeURIComponent(storageState.cookies.find((cookie) => cookie.name.endsWith("session_token"))!.value).split(".")[0];
    expect((await db.query("select 1 from auth_session where token = $1", [token])).rowCount).toBe(1);

    await page.goto("/");
    await page.getByRole("button", { name: /Alex Morgan/ }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    expect((await db.query("select 1 from auth_session where token = $1", [token])).rowCount).toBe(0);
    expect((await context.cookies()).filter((cookie) => cookie.name.endsWith("session_token") && cookie.value)).toEqual([]);
    for (const path of ["/overview", "/settings", "/customers"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    // The front door is the public landing again, with nothing of the workspace in it.
    await page.goto("/");
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Find HVAC service. Run the business behind it." })).toBeVisible();
    await expect(page.getByText("Apex")).toHaveCount(0);
    await context.close();
  });

  test("after Log out the Back button does not bring the workspace back", async ({ browser, workerTenant, clientAddresses }) => {
    const storageState = await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses());
    const context = await browser.newContext({ storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 2, name: "Business information" })).toBeVisible();
    await page.getByRole("button", { name: /Alex Morgan/ }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("Business name")).toHaveCount(0);
    await context.close();
  });

  test("a session that has expired in the database is not honoured, even though the browser still holds the cookie", async ({ browser, workerTenant, clientAddresses, db }) => {
    const storageState = await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses());
    const context = await browser.newContext({ storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 2, name: "Business information" })).toBeVisible();

    const token = decodeURIComponent(storageState.cookies.find((cookie) => cookie.name.endsWith("session_token"))!.value).split(".")[0];
    await db.query("update auth_session set expires_at = now() - interval '1 minute' where token = $1", [token]);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("Business name")).toHaveCount(0);
    await context.close();
  });

  test("a session removed from the database (signed out elsewhere) stops working on the next request", async ({ browser, workerTenant, clientAddresses, db }) => {
    const storageState = await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses());
    const context = await browser.newContext({ storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const token = decodeURIComponent(storageState.cookies.find((cookie) => cookie.name.endsWith("session_token"))!.value).split(".")[0];
    await db.query("delete from auth_session where token = $1", [token]);
    await page.goto("/payments");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("a forged session cookie is not a session", async ({ browser, clientAddresses }) => {
    const context = await browser.newContext({
      storageState: { cookies: [{ name: "better-auth.session_token", value: "forged.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D", domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: -1 }], origins: [] },
      extraHTTPHeaders: { "x-forwarded-for": clientAddresses() },
    });
    const page = waitsForHydration(await context.newPage());
    for (const path of ["/overview", "/customers", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText("Apex")).toHaveCount(0);
    }
    // At the front door a forged cookie is simply a visitor: the landing, with no workspace.
    await page.goto("/");
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Find HVAC service. Run the business behind it." })).toBeVisible();
    await expect(page.getByText("Apex")).toHaveCount(0);
    await context.close();
  });
});

test.describe("the sign-in endpoints keep Better Auth's protections", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a sign-in request from another origin is refused", async ({ playwright, clientAddresses }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { origin: "https://evil.example", "x-forwarded-for": clientAddresses() } });
    const response = await api.post("/api/auth/sign-in/email", { data: { email: SEED.alex, password: SEED_PASSWORD } });
    expect(response.status()).toBe(403);
    expect((await api.storageState()).cookies.filter((cookie) => cookie.name.endsWith("session_token"))).toEqual([]);
    await api.dispose();
  });

  test("repeated sign-in attempts from one address are rate limited", async ({ playwright, clientAddresses }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { origin: ORIGIN, "x-forwarded-for": clientAddresses() } });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await api.post("/api/auth/sign-in/email", { data: { email: SEED.alex, password: "wrong-password-1" } })).status());
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses).toContain(429);
    await api.dispose();
  });

  test("sign-in answers are never cached", async ({ playwright, clientAddresses }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { origin: ORIGIN, "x-forwarded-for": clientAddresses() } });
    const response = await api.get("/api/auth/get-session");
    expect(response.headers()["cache-control"] ?? "").not.toMatch(/public|s-maxage/);
    await api.dispose();
  });
});
