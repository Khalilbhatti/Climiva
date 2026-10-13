/**
 * Docker side, part 3: a customer's domain through the real proxy, with real TLS handshakes against Caddy's on-demand authorization.
 *
 *   - a certificate is issued, on demand, ONLY for the exact name of an active domain of a published Site: pending, verified, disabled, removed and
 *     unknown names get no handshake at all, and nothing is requested from a public certificate authority (the local CA is the only issuer here);
 *   - an active customer's name shows that business's Site and nothing else: no sign-in, no workspace, no Builder, no preview, no API, no health or
 *     internal endpoint, even when the request carries a valid session cookie;
 *   - the Host the browser sent is what the application sees, and no header a client can send changes it;
 *   - a visitor can book through the customer's own name and the booking is the name's business's;
 *   - disabling the domain stops it serving at once, and enabling it again restores it.
 *
 * Local certificates prove the MECHANICS (the question asked, the answer obeyed, the Host kept). They prove nothing about a public certificate authority.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "playwright/test";
import { PASSWORD, waitsForHydration } from "../e2e/saas";
import { compose, composeResult, cookieHeader, get, handshake, one, sql, stack } from "./stack";

test.describe.configure({ mode: "serial" });

// What 02 left behind. Read when the file starts running, not when it is loaded: on a new stack the file does not exist until 02 has run.
let state: { email: string; business: string; slug: string };
const rand = () => randomBytes(3).toString("hex");
const hosts = {
  active: `active-${rand()}.example.test`,
  pending: `pending-${rand()}.example.test`,
  verified: `verified-${rand()}.example.test`,
  disabled: `disabled-${rand()}.example.test`,
  removed: `removed-${rand()}.example.test`,
  unknown: `nobody-${rand()}.example.test`,
};

function claim(host: string, status: "pending_verification" | "verified" | "active" | "disabled" | "removed") {
  const stamp = (on: boolean) => (on ? "now()" : "null");
  const token = randomBytes(32).toString("base64url");
  sql(
    `insert into site_domains (organization_id, site_id, hostname, status, verification_token, verified_at, activated_at, disabled_at, removed_at, is_primary)
     select organization_id, id, '${host}', '${status}', '${token}', ${stamp(status === "verified" || status === "active" || status === "disabled")}, ${stamp(status === "active" || status === "disabled")}, ${stamp(status === "disabled")}, ${stamp(status === "removed")}, false from sites where slug = 'main'`,
  );
}

let context: BrowserContext;

test.beforeAll(async ({ browser }) => {
  state = JSON.parse(readFileSync(".data/docker-state.json", "utf8"));
  context = await browser.newContext({ baseURL: stack.origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  // Sign in as the business's owner (the person 02 created), so a real session cookie exists for the tests that carry one to the customer's name.
  const signIn = await get(stack.publicHost, "/api/auth/sign-in/email", { method: "POST", headers: { origin: stack.origin, "content-type": "application/json" }, body: JSON.stringify({ email: state.email, password: PASSWORD }) });
  expect(signIn.status).toBe(200);
  const setCookies = ([] as string[]).concat((signIn.headers["set-cookie"] as string[] | string | undefined) ?? []);
  await context.addCookies(
    setCookies.map((line) => {
      const [pair] = line.split(";");
      const [name, ...value] = pair.split("=");
      return { name: name.trim(), value: value.join("="), domain: stack.publicHost, path: "/", secure: true };
    }),
  );
});
test.afterAll(async () => {
  await context.close();
});

test("only an ACTIVE domain of a PUBLISHED site gets a certificate; every other name is refused at the handshake", async () => {
  claim(hosts.active, "active");
  claim(hosts.pending, "pending_verification");
  claim(hosts.verified, "verified");
  claim(hosts.disabled, "disabled");
  claim(hosts.removed, "removed");

  const allowed = await handshake(hosts.active);
  expect(allowed, JSON.stringify(allowed)).toMatchObject({ ok: true });
  if (allowed.ok) expect(allowed.issuer).toMatch(/Caddy Local Authority/i);

  for (const [label, host] of Object.entries(hosts)) {
    if (label === "active") continue;
    const refused = await handshake(host);
    expect(refused.ok, `${label} (${host}) must not get a certificate`).toBe(false);
  }

  // What Caddy kept: certificates for the application's own name and the one active domain, issued by the LOCAL authority. Nothing from a public
  // CA, and nothing for a refused name.
  const issued = compose("exec", "-T", "proxy", "find", "/data/caddy/certificates", "-name", "*.crt").split(/\r?\n/).filter(Boolean);
  expect(issued.some((path) => path.includes(`/${hosts.active}/`))).toBe(true);
  for (const host of Object.values(hosts)) if (host !== hosts.active) expect(issued.some((path) => path.includes(`/${host}/`)), host).toBe(false);
  expect(issued.every((path) => path.includes("/certificates/local/"))).toBe(true);
  const log = compose("logs", "proxy", "--no-log-prefix");
  expect(log).not.toMatch(/acme-v02\.api\.letsencrypt\.org|acme\.zerossl\.com|letsencrypt\.org\/directory/);
  writeFileSync(".data/docker-domain.json", JSON.stringify({ active: hosts.active, certificate: allowed.ok ? allowed.fingerprint : null }));
});

test("the permission question, asked from inside the stack: yes only for the active name, the same bare no for everything else", async () => {
  const token = stack.env.TLS_ASK_TOKEN ?? "";
  const ask = (host: string, secret = token) =>
    compose("exec", "-T", "app", "node", "-e", `fetch(process.argv[1]).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()})))`, `http://127.0.0.1:3000/internal/tls-allow?token=${encodeURIComponent(secret)}&domain=${encodeURIComponent(host)}`).trim();
  expect(JSON.parse(ask(hosts.active))).toEqual({ status: 200, body: "" });
  for (const host of [hosts.pending, hosts.verified, hosts.disabled, hosts.removed, hosts.unknown, "localhost", "not a name"]) expect(JSON.parse(ask(host)), host).toEqual({ status: 404, body: "" });
  expect(JSON.parse(ask(hosts.active, "wrong"))).toEqual({ status: 404, body: "" });
  expect(JSON.parse(ask(hosts.active, ""))).toEqual({ status: 404, body: "" });
  // The proxy can reach it (that is how it asks); the Internet can not.
  expect(composeResult("exec", "-T", "proxy", "wget", "-q", "-O", "/dev/null", `http://app:3000/internal/tls-allow?token=${token}&domain=${hosts.active}`).code).toBe(0);
  expect(composeResult("exec", "-T", "proxy", "wget", "-q", "-O", "/dev/null", `http://app:3000/internal/tls-allow?token=${token}&domain=${hosts.unknown}`).code).not.toBe(0);
  for (const path of [`/internal/tls-allow?token=${token}&domain=${hosts.active}`, "/internal", "/INTERNAL/tls-allow", "//internal/tls-allow", "/%69nternal/tls-allow"]) {
    expect((await get(stack.publicHost, path)).status, path).toBe(404);
    expect((await get(hosts.active, path)).status, `${path} on a customer's name`).toBe(404);
  }
});

test("an active customer's name shows that business's published Site, through the same pages as the platform address", async () => {
  for (const path of ["/", "/services", "/about", "/contact", "/booking", "/booking/docker-tune-up"]) {
    const response = await get(hosts.active, path);
    expect(response.status, path).toBe(200);
    expect(response.body, path).toContain(state.business.replace("&", "&amp;"));
    expect(response.headers["strict-transport-security"], path).toBeDefined();
  }
  const home = (await get(hosts.active, "/")).body;
  expect(home).toMatch(/\/assets\/[0-9a-f-]{36}/);
  // Links stay on the customer's name, never the platform's /sites paths.
  expect(home).not.toContain(`/sites/${state.slug}`);
  // The logo, drawn from the customer's name, is the same public route with the same policy.
  const logo = home.match(/\/assets\/[0-9a-f-]{36}/)?.[0] ?? "";
  const served = await get(hosts.active, logo);
  expect(served.status).toBe(200);
  expect(served.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
});

test("on a customer's name nothing private exists, even for a request that carries a valid session", async () => {
  const cookie = await cookieHeader(context);
  expect(cookie).toMatch(/session_token/);
  const origin = `https://${hosts.active}:${stack.httpsPort}`;
  const paths = ["/login", "/signup", "/onboarding", "/settings", "/settings/branding", "/website", "/website/builder", "/website/preview", "/website/domain", "/customers", "/payments", "/quotes-invoices", "/api/auth/get-session", "/api/auth/sign-in/email", "/api/branding", "/health/live", "/health/ready", "/internal/tls-allow", "/_next/data/x.json", "/nope"];
  for (const path of paths) {
    for (const method of ["GET", "POST"]) {
      const response = await get(hosts.active, path, { method, headers: { cookie, origin, ...(method === "POST" ? { "content-type": "application/json" } : {}) }, body: method === "POST" ? "{}" : undefined });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.body, `${method} ${path}`).not.toMatch(/Workspace Overview|Log in|better-auth|"user"|"session"|organization/i);
    }
  }
  // An upload aimed at the customer's name creates nothing.
  expect(Number(one("select count(*) from assets"))).toBe(3);
});

test("the Host decides, not the handshake: a request that names an unknown Host over an active name's connection is a plain not found", async () => {
  // The connection is made for the active name (it has a certificate); the request inside it names a name nobody activated.
  const response = await get(hosts.active, "/", { headers: { host: `${hosts.unknown}:${stack.httpsPort}` } });
  expect(response.status).toBe(404);
  expect(response.body).not.toContain(state.business.replace("&", "&amp;"));
  const pending = await get(hosts.active, "/", { headers: { host: `${hosts.pending}:${stack.httpsPort}` } });
  expect(pending.status).toBe(404);
});

test("the name the browser sent decides the business; no header a client can send does", async () => {
  // A request that names the platform's address in every header a client can send is still a request for the customer's site.
  const forged = { "x-forwarded-host": stack.publicHost, forwarded: `host=${stack.publicHost};proto=https`, "x-original-host": stack.publicHost, "x-host": stack.publicHost, "x-forwarded-server": stack.publicHost };
  const customer = await get(hosts.active, "/", { headers: forged });
  expect(customer.status).toBe(200);
  expect(customer.body).toContain(state.business.replace("&", "&amp;"));
  const customerLogin = await get(hosts.active, "/login", { headers: forged });
  expect(customerLogin.status, "a forged platform address does not open the sign-in page on a customer's name").toBe(404);
  // And the other way round: the platform's address, claiming to be the customer's name, is still the platform.
  const claimingCustomer = { "x-forwarded-host": hosts.active, forwarded: `host=${hosts.active}`, "x-original-host": hosts.active, "x-host": hosts.active, "x-forwarded-server": hosts.active };
  const platform = await get(stack.publicHost, "/login", { headers: claimingCustomer });
  expect(platform.status).toBe(200);
  expect(platform.body).toMatch(/Log in/i);
  const platformRoot = await get(stack.publicHost, "/", { headers: claimingCustomer });
  expect([307, 308]).toContain(platformRoot.status);
  expect(String(platformRoot.headers.location)).toContain("/login");
  // A name that merely CONTAINS the application's own is a customer's name, not the platform.
  const lookalike = `${stack.publicHost}.example.test`;
  expect((await get(stack.publicHost, "/login", { headers: { host: lookalike } })).status).toBe(404);
  // A name BENEATH the application's own is the platform's by design (nobody may claim it), so it is never given a certificate on demand.
  expect((await handshake(`x.${stack.publicHost}`)).ok).toBe(false);
});

test("a visitor books through the customer's own name, and the booking is the name's business's", async () => {
  const email = `visitor-${rand()}@example.test`;
  const next = new Date();
  next.setDate(next.getDate() + ((9 - next.getDay()) % 7 || 7)); // the next Tuesday
  const date = next.toISOString().slice(0, 10);
  const visitor = waitsForHydration(await context.browser()!.newContext({ ignoreHTTPSErrors: true }).then((created) => created.newPage()));
  await visitor.goto(`https://${hosts.active}:${stack.httpsPort}/booking/docker-tune-up`);
  await expect(visitor.getByRole("heading", { name: "Choose a date and time" })).toBeVisible();
  await visitor.getByLabel("Date", { exact: true }).fill(date);
  await visitor.getByRole("radio").first().check();
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByLabel(/^Full name/).fill("Jordan Visitor");
  await visitor.getByLabel(/^Phone number/).fill("(303) 555-0111");
  await visitor.getByLabel(/^Email address/).fill(email);
  await visitor.getByLabel(/^Service address/).fill("12 Aspen Way, Denver, CO 80203");
  await visitor.getByRole("button", { name: "Confirm booking" }).click();
  await expect(visitor.getByRole("region", { name: "Instant booking confirmed" })).toContainText(/BK-\d{4}/);
  expect(visitor.url()).toContain(hosts.active);
  const rows = sql(`select b.status, b.source, o.slug, s.slug from bookings b join organizations o on o.id = b.organization_id join services s on s.id = b.service_id and s.organization_id = b.organization_id where b.contact_email = '${email}'`);
  expect(rows).toEqual([["confirmed", "Website", state.slug, "docker-tune-up"]]);
  // The visitor's page carried nothing of the business's other records.
  const text = await visitor.locator("body").innerText();
  expect(text).not.toContain("Dana Owner");
  expect(text).not.toContain(state.email);
  expect(text).not.toMatch(/Workspace Overview|Quotes & Invoices|Payments/);
  await visitor.context().close();
});

test("disabling the domain stops it serving at once, and enabling it again brings it back", async () => {
  expect((await get(hosts.active, "/")).status).toBe(200);
  sql(`update site_domains set status = 'disabled', disabled_at = now() where hostname = '${hosts.active}'`);
  const off = await get(hosts.active, "/");
  expect(off.status).toBe(404);
  expect(off.body).not.toContain(state.business.replace("&", "&amp;"));
  // Its certificate is still in the proxy; the application is what stops answering for the name, and the permission question is now "no".
  expect(composeResult("exec", "-T", "proxy", "wget", "-q", "-O", "/dev/null", `http://app:3000/internal/tls-allow?token=${stack.env.TLS_ASK_TOKEN}&domain=${hosts.active}`).code).not.toBe(0);
  sql(`update site_domains set status = 'active', disabled_at = null where hostname = '${hosts.active}'`);
  const on = await get(hosts.active, "/");
  expect(on.status).toBe(200);
  expect(on.body).toContain(state.business.replace("&", "&amp;"));
});
