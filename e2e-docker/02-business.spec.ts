/**
 * Docker side, part 2: a real first user on the empty production database, through the proxy.
 *
 *   - an anonymous visitor finds Climvia's landing and an empty Marketplace, and looking creates nothing;
 *   - the first person signs up from the landing's "List Your Business" and sets a business up (the onboarding writes the organization, owner, hours and
 *     first Site in one transaction), and lands on a workspace with nothing in it but things to do;
 *   - a Service is added, and the first customer is added by hand on a database that has none (no import, no fixture), and the workspace's modules read
 *     the database as the restricted role, the Builder opens;
 *   - a logo is uploaded as PNG, JPEG and WebP: `sharp`, inside the read-only production container, re-encodes each, the files land on the persistent
 *     volume, and the public route serves them with the asset's own Content-Security-Policy;
 *   - the Site is published and is served on the platform's address.
 *
 * The state this leaves (one business, one owner, three logos, a published Site) is what the later parts build on (07 lists it on the Marketplace) and the
 * lifecycle tests (09) restart and recreate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test, type BrowserContext, type Page } from "playwright/test";
import { completeOnboarding, PASSWORD, signUp, waitsForHydration } from "../e2e/saas";
import { compose, cookieHeader, get, multipart, one, sql, stack } from "./stack";

test.describe.configure({ mode: "serial" });

/** A request to the stack as the signed-in person (their cookie, this site's own Origin), made from Node straight to the proxy. */
async function asPerson(path: string, init: { json?: unknown; form?: ReturnType<typeof multipart>; headers?: Record<string, string> } = {}) {
  const type: Record<string, string> = init.json !== undefined ? { "content-type": "application/json" } : init.form ? { "content-type": init.form.contentType } : {};
  return get(stack.publicHost, path, {
    method: "POST",
    headers: { cookie: await cookieHeader(context), origin: stack.origin, ...type, ...init.headers },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form?.body,
  });
}

const BUSINESS = "Docker Heating & Air";
const SLUG = "docker-heating-air";

let context: BrowserContext;
let page: Page;
let email = "";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: stack.origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  page = waitsForHydration(await context.newPage());
});
test.afterAll(async () => {
  await context.close();
});

test("an anonymous visitor finds the landing and an empty Marketplace, and looking creates nothing", async () => {
  const landing = await get(stack.publicHost, "/");
  expect(landing.status).toBe(200);
  expect(landing.body).toContain("Find HVAC service. Run the business behind it.");
  const marketplace = await get(stack.publicHost, "/marketplace");
  expect(marketplace.status).toBe(200);
  expect(marketplace.body).toContain("No providers are listed yet");
  const sitemap = await get(stack.publicHost, "/sitemap.xml");
  expect(sitemap.body).toContain(`<loc>${stack.origin}/</loc>`);
  expect(sitemap.body).not.toContain("/listings/");
  for (const table of ["auth_user", "organizations", "auth_session", "marketplace_listings", "platform_admins"]) expect(Number(one(`select count(*) from ${table}`)), table).toBe(0);
  // Nothing from the sample businesses is in a production database, and nothing is made by looking.
  expect(Number(one("select count(*) from organizations where fixture_set is not null or slug in ('apex-climate-heating-air', 'northstar-heating-cooling')"))).toBe(0);
});

test("the first person signs up from the landing and sets up a business on the empty database", async () => {
  expect(Number(one("select count(*) from organizations"))).toBe(0);
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "List Your Business" }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  email = await signUp(page, { name: "Dana Owner" });
  await completeOnboarding(page, { name: BUSINESS });
  await expect(page).toHaveURL(/\/overview$/);
  // A workspace with nothing in it but things to do: Getting started with five steps, none done, no sample record and no invented figure.
  await expect(page.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Setup steps" }).getByRole("link")).toHaveCount(5);
  expect(await page.locator("main").innerText()).not.toMatch(/Apex|Northstar|Sarah Mitchell|NaN|undefined|\$\d/);
  expect(Number(one("select count(*) from customers"))).toBe(0);
  expect(Number(one("select count(*) from team_members"))).toBe(1);
  expect(sql("select name, slug from organizations")).toEqual([[BUSINESS, SLUG]]);
  expect(sql("select role from organization_memberships m join auth_user u on u.id = m.user_id where u.email = '" + email + "'")).toEqual([["owner"]]);
  expect(sql("select slug, platform_slug, status from sites")).toEqual([["main", SLUG, "draft"]]);
  expect(Number(one("select count(*) from organization_business_hours"))).toBe(7);
  // The next steps (and the lifecycle tests) sign in as this person again.
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/docker-state.json", JSON.stringify({ email, password: PASSWORD, business: BUSINESS, slug: SLUG }));
});

test("signing in again works: sessions are kept in the database", async () => {
  const before = Number(one("select count(*) from auth_session"));
  const response = await asPerson("/api/auth/sign-in/email", { json: { email, password: PASSWORD } });
  expect(response.status).toBe(200);
  expect(Number(one("select count(*) from auth_session"))).toBeGreaterThan(before);
  // A wrong password is refused, and the answer does not say which part was wrong.
  const wrong = await asPerson("/api/auth/sign-in/email", { json: { email, password: "Wrong-horse-9" } });
  expect(wrong.status).toBeGreaterThanOrEqual(400);
  expect(wrong.status).toBeLessThan(500);
  expect(wrong.body).not.toMatch(/password is (wrong|incorrect)|no such (user|email)|user not found/i);
});

test("a Service is added through the wizard and the Website shows it", async () => {
  await page.goto("/services");
  await page.getByRole("button", { name: "Add service" }).click();
  const wizard = page.getByRole("dialog", { name: "Add new service" });
  await wizard.getByLabel("Service name").fill("Docker Tune-up");
  await wizard.getByLabel("Customer-facing description").fill("A tune-up, booked on a customer's own domain.");
  await wizard.getByRole("button", { name: /^Next: How customers book/ }).click();
  await wizard.getByRole("radio", { name: /^Instant booking/ }).check();
  await wizard.getByRole("button", { name: /^Next: Pricing/ }).click();
  await wizard.getByLabel("Fee amount (USD)").or(wizard.getByLabel("Price (USD)")).fill("75");
  await wizard.getByRole("button", { name: /^Next: Where customers see it/ }).click();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  await wizard.getByRole("button", { name: "Add service" }).click();
  await expect(wizard).toBeHidden();
  expect(sql("select slug, booking_method from services")).toEqual([["docker-tune-up", "instant"]]);
  await page.goto("/website");
  await expect(page.getByText("Services shown", { exact: false }).first()).toBeVisible();
  await expect(page.locator("main")).toContainText(/1 Service/);
});

test("the owner adds the first customer by hand on the empty database: it is on the list and its page opens, with nothing imported", async () => {
  expect(Number(one("select count(*) from customers"))).toBe(0);
  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "No customers yet" })).toBeVisible();
  await page.getByRole("button", { name: "Add customer" }).click();
  const dialog = page.getByRole("dialog", { name: "Add customer" });
  await dialog.getByLabel(/^Full name/).fill("Pat Walker");
  await dialog.getByLabel("Email address").fill("pat.walker@example.test");
  await dialog.getByLabel("Phone number").fill("303.555.0160");
  await dialog.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/customers\/pat-walker$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pat Walker" })).toBeVisible();
  expect(sql("select o.slug, c.slug, c.name, c.phone, c.email from customers c join organizations o on o.id = c.organization_id")).toEqual([[SLUG, "pat-walker", "Pat Walker", "(303) 555-0160", "pat.walker@example.test"]]);
  await page.goto("/customers");
  await expect(page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "Pat Walker" })).toBeVisible();
});

test("every workspace module reads the database as the restricted role, and the Builder opens", async () => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  for (const path of ["/", "/bookings", "/schedule", "/jobs", "/customers", "/services", "/team", "/quotes-invoices", "/payments", "/maintenance-plans", "/website", "/website/builder", "/website/templates", "/website/domain", "/marketplace", "/reviews", "/marketing", "/analytics", "/settings", "/settings/branding"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("main, [role=main]").first(), path).toBeVisible();
    await expect(page.locator("body"), path).not.toContainText(/Application error|Internal Server Error|Something went wrong/i);
  }
  expect(problems).toEqual([]);
  // The Builder showed a real editor, not an error shell.
  await page.goto("/website/builder");
  await expect(page.getByRole("button", { name: /Publish/ }).first()).toBeVisible();
});

test("a logo is uploaded as PNG, JPEG and WebP: sharp re-encodes each inside the production container and the public route serves it with its own policy", async () => {
  const stored: { id: string; sha: string }[] = [];
  for (const format of ["png", "jpeg", "webp"] as const) {
    const source = await sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 13, g: 92, b: 99 } } })[format]().toBuffer();
    const response = await asPerson("/api/branding", { form: multipart({ accent: "#17766B" }, { field: "logo", name: `crest.${format}`, type: `image/${format}`, bytes: source }) });
    expect(response.status, format).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; branding: { logo: { src: string } } };
    expect(body.ok).toBe(true);
    const src = body.branding.logo.src;
    expect(src).toMatch(/^\/assets\/[0-9a-f-]{36}$/);

    // Anyone can fetch it, through the proxy, with no cookie.
    const served = await get(stack.publicHost, src);
    expect(served.status, format).toBe(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect(served.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-disposition"]).toBe("inline");
    expect(served.headers["strict-transport-security"]).toBeDefined();
    const bytes = served.bytes;
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    stored.push({ id: src.split("/").pop() ?? "", sha: createHash("sha256").update(bytes).digest("hex") });
  }
  expect(new Set(stored.map((logo) => logo.id)).size).toBe(3);

  // The database knows three READY assets, one of them chosen; the bytes are files on the persistent volume, owned by the app's user.
  expect(sql("select media_type, status, storage_driver from assets order by created_at")).toEqual([["image/webp", "ready", "local"], ["image/webp", "ready", "local"], ["image/webp", "ready", "local"]]);
  expect(one("select logo_asset_id from organization_branding")).toBe(stored[2].id);
  const files = compose("exec", "-T", "app", "find", "/data/assets", "-type", "f").split(/\r?\n/).filter(Boolean);
  expect(files.length).toBe(3);
  expect(compose("exec", "-T", "app", "stat", "-c", "%u", ...files).trim().split(/\r?\n/)).toEqual(["10001", "10001", "10001"]);
  // Only the chosen one is public; the two replaced ones are the same plain 404 as an id that never existed.
  expect((await get(stack.publicHost, `/assets/${stored[0].id}`)).status).toBe(404);
  expect((await get(stack.publicHost, `/assets/${stored[1].id}`)).status).toBe(404);
  expect((await get(stack.publicHost, `/assets/${stored[2].id}`)).status).toBe(200);
  writeFileSync(".data/docker-logo.json", JSON.stringify(stored[2]));
});

test("a logo that is not an image, or is too large, is refused by the production container", async () => {
  const notAnImage = await asPerson("/api/branding", { form: multipart({ accent: "" }, { field: "logo", name: "x.png", type: "image/png", bytes: Buffer.from("<svg onload=alert(1)></svg>") }) });
  expect(notAnImage.status).toBeGreaterThanOrEqual(400);
  expect(notAnImage.status).toBeLessThan(500);
  // Above the proxy's 8 MB limit the proxy refuses it before the application sees a byte.
  const huge = await asPerson("/api/branding", { form: multipart({ accent: "" }, { field: "logo", name: "huge.png", type: "image/png", bytes: Buffer.alloc(9 * 1024 * 1024, 1) }) });
  expect([400, 413]).toContain(huge.status);
  // A page of another site, naming itself the server through every header a client can send, is not this application's own page.
  const forged = await asPerson("/api/branding", {
    form: multipart({ accent: "" }),
    headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example", forwarded: "host=evil.example;proto=https", "x-original-host": "evil.example" },
  });
  expect(forged.status).toBe(403);
  expect(Number(one("select count(*) from assets where status = 'ready'"))).toBe(3);
});

test("publishing makes the Site public on the platform's address, with its logo and its Service", async () => {
  await page.goto("/website");
  expect(Number(one("select count(*) from sites where published_version_id is not null"))).toBe(0);
  await page.getByRole("button", { name: "Publish website" }).first().click();
  await expect.poll(() => one("select count(*) from sites where published_version_id is not null"), { timeout: 20_000 }).toBe("1");

  const home = await get(stack.publicHost, `/sites/${SLUG}`);
  expect(home.status).toBe(200);
  expect(home.body).toContain(BUSINESS.replace("&", "&amp;"));
  expect(home.body).toMatch(/\/assets\/[0-9a-f-]{36}/);
  const booking = await get(stack.publicHost, `/sites/${SLUG}/booking`);
  expect(booking.status).toBe(200);
  expect(booking.body).toContain("Docker Tune-up");
  // Nothing of the workspace is in a public page.
  expect(home.body).not.toContain(email);
  expect(home.body).not.toMatch(/organization_id|better-auth|session/i);
  expect((await get(stack.publicHost, "/sites/no-such-site")).status).toBe(404);
});
