/**
 * Phase 19D, the final host matrix, asked of the running (production-built) server: every kind of Host against every kind of path.
 *
 *   - the platform's own host (and the names a deployment lists for itself) serves Climvia's public surfaces: the landing, the Marketplace, a provider's
 *     profile, a business's path-based Site (`/sites/<slug>`), Log in and Sign up, and sends everything private to a sign-in page;
 *   - a customer's domain with an ACTIVE claim serves that customer's published Site at its root, and NOTHING else of Climvia's: not the landing, the
 *     Marketplace, a profile, Log in, Sign up, set-up, the workspace, the Builder, the previews, the console, a review page, the session answer, an API,
 *     the health probes or the certificate question, whoever asks, with or without a session, and whatever headers it sends;
 *   - a name that is pending, verified, disabled, unknown, a lookalike of the platform's, or not a name at all is a plain not found, and never a business.
 *
 * Only the `Host` header chooses. The rules themselves (which names are the platform's under which configuration) are held in entry-rules and
 * release-rules; here the running server answers.
 */
import { randomBytes } from "node:crypto";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { createDraftFromTemplate, publishSite, type SiteContext } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { signedIn } from "./assets-helpers";
import { insertActiveClaim, rawRequest, uniqueHost, type RawResponse } from "./domain-helpers";
import { setHeadlineOf } from "./draft-edits";
import { makeProvider, SAMPLE_SERVICES, type Provider } from "./marketplace-helpers";

const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3460";
const PORT = new URL(ORIGIN).port;
const LANDING = "Find HVAC service. Run the business behind it.";

let owner: ReturnType<typeof adminDb>;
let provider: Provider;
let siteSlug = "";
let headline = "";
let activeHost = "";
let pendingHost = "";
let sessionCookie = "";

const onHost = (host: string, path = "/", options: { method?: string; headers?: Record<string, string> } = {}): Promise<RawResponse> =>
  rawRequest(ORIGIN, path, { host: `${host}:${PORT}`, ...options });
const onPlatform = (path: string, options: { method?: string; headers?: Record<string, string> } = {}) => rawRequest(ORIGIN, path, options);

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test.beforeAll(async () => {
  owner = adminDb();
  provider = await makeProvider("hostmatrix", { db: owner.db, pool: owner.pool });
  const organizationId = provider.business.organizationId;
  const site = await owner.pool.query<{ id: string; platform_slug: string }>("select id, platform_slug from sites where organization_id = $1 and slug = 'main'", [organizationId]);
  siteSlug = site.rows[0].platform_slug;
  headline = `Matrix headline ${randomBytes(3).toString("hex")}`;
  const who = { userId: provider.business.owner.userId, organizationId };
  await withTenant(who, async (tx) => {
    const ctx: SiteContext = { tx, organizationId };
    await createDraftFromTemplate(ctx, site.rows[0].id, DEFAULT_TEMPLATE_KEY);
    await setHeadlineOf(ctx, site.rows[0].id, headline);
    await publishSite(ctx, site.rows[0].id, who.userId);
  });
  activeHost = uniqueHost("mxactive");
  await insertActiveClaim(owner.pool, organizationId, activeHost);
  pendingHost = uniqueHost("mxpending");
  await owner.pool.query(
    `insert into site_domains (organization_id, site_id, hostname, status, verification_token, is_primary)
     select organization_id, id, $2, 'pending_verification', $3, false from sites where organization_id = $1 and slug = 'main'`,
    [organizationId, pendingHost, randomBytes(32).toString("base64url")],
  );
  const api = await signedIn(provider.business.owner.email, `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::7`);
  sessionCookie = (await api.storageState()).cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  await api.dispose();
});
test.afterAll(async () => {
  await owner.pool.end();
});

/** Every path a deployment has that is not a customer's page. */
const surfaces = () => {
  const token = randomBytes(32).toString("base64url");
  return {
    landing: ["/"],
    marketplace: ["/marketplace", "/marketplace?q=heat", "/marketplace/services/heating-repair", "/marketplace/locations/austin-tx", "/sitemap.xml", "/robots.txt"],
    profile: [`/listings/${provider.slug}`, `/listings/${provider.slug}/book/${SAMPLE_SERVICES.repair}`],
    pathSite: [`/sites/${siteSlug}`, `/sites/${siteSlug}/services`, "/sites"],
    auth: ["/login", "/signup", "/onboarding"],
    workspace: ["/overview", "/customers", "/bookings", "/schedule", "/jobs", "/quotes", "/invoices", "/reviews", "/website", "/website/builder", "/website/preview", "/website/domain", "/marketplace-listing", "/marketplace-listing/preview", "/settings", "/team", "/analytics"],
    console: ["/platform-admin", "/platform-admin/login", "/platform-admin/reviews", "/platform-admin/marketplace", "/platform-admin/system"],
    review: [`/review/${token}`],
    session: ["/api/session-state", "/api/auth/get-session", "/api/branding"],
    plumbing: ["/health/live", "/health/ready", "/internal/tls-allow", `/internal/tls-allow?token=${process.env.TLS_ASK_TOKEN}&domain=${activeHost}`],
    internals: ["/_next/data/x/index.json", "/custom-site", "/custom-site/services"],
  };
};

/* ───────────────────────────── the platform's own host ───────────────────────────── */

test.describe("the platform's own host, asked by a visitor", () => {
  test("serves the public surfaces: the landing, the Marketplace, a profile, a path-based Site, Log in and Sign up, the files a crawler reads and the probes", async () => {
    const s = surfaces();
    for (const path of ["/", ...s.marketplace.filter((item) => !item.includes("/services/") && !item.includes("/locations/")), ...s.profile.slice(0, 1), s.pathSite[0], "/login", "/signup", "/api/session-state", "/health/live", "/health/ready"]) {
      const response = await onPlatform(path);
      expect(response.status, path).toBe(200);
    }
    const landing = await onPlatform("/");
    expect(text(landing.body)).toContain(LANDING);
    // The path-first Site is the business's own words, on the platform's host.
    expect(text((await onPlatform(`/sites/${siteSlug}`)).body)).toContain(headline);
    // A profile of a provider that is published, and the booking page under it.
    expect((await onPlatform(`/listings/${provider.slug}/book/${SAMPLE_SERVICES.repair}`)).status).toBe(200);
  });

  test("sends everything private to a sign-in page and shows nothing of it: the workspace to Log in, the console to its own sign-in, the set-up page to Log in", async () => {
    const s = surfaces();
    for (const path of [...s.workspace, "/onboarding"]) {
      const response = await onPlatform(path);
      expect([307, 308], path).toContain(response.status);
      expect(String(response.headers.location), path).toMatch(/\/login(\?|$)/);
      expect(response.body, path).not.toContain(headline);
    }
    for (const path of ["/platform-admin", "/platform-admin/reviews", "/platform-admin/marketplace", "/platform-admin/system"]) {
      const response = await onPlatform(path);
      expect([307, 308], path).toContain(response.status);
      expect(String(response.headers.location), path).toContain("/platform-admin/login");
    }
    expect((await onPlatform("/platform-admin/login")).status).toBe(200);
    // The certificate question is refused without its secret, and the answer for an unknown name is the same bare no.
    expect((await onPlatform("/internal/tls-allow")).status).toBe(404);
    expect((await onPlatform(`/internal/tls-allow?token=wrong&domain=${activeHost}`)).status).toBe(404);
    expect((await onPlatform(`/internal/tls-allow?token=${process.env.TLS_ASK_TOKEN}&domain=${activeHost}`)).status).toBe(200);
    expect((await onPlatform(`/internal/tls-allow?token=${process.env.TLS_ASK_TOKEN}&domain=${pendingHost}`)).status).toBe(404);
  });

  test("a review link that holds no secret is the same plain not found as any unknown address, and sets nothing", async () => {
    const response = await onPlatform(`/review/${randomBytes(32).toString("base64url")}`);
    expect(response.status).toBe(404);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  test("an IP address and a one-label name are the platform's, and a name that merely looks like it is not", async () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]) {
      const response = await rawRequest(ORIGIN, "/", { host });
      expect(response.status, host).toBe(200);
      expect(text(response.body), host).toContain(LANDING);
    }
    for (const host of [`localhost.example.test:${PORT}`, `www.localhost.example.test:${PORT}`, `xlocalhost.example.test:${PORT}`]) {
      const response = await rawRequest(ORIGIN, "/", { host });
      expect(response.status, host).toBe(404);
      expect(response.body, host).not.toContain(LANDING);
    }
  });
});

/* ───────────────────────────── a customer's domain ───────────────────────────── */

test.describe("a customer's domain with an active claim", () => {
  test("`/` is the customer's published Site; every other Climvia surface is a plain not found, anonymous or signed in as the business's own owner", async () => {
    const root = await onHost(activeHost, "/");
    expect(root.status).toBe(200);
    expect(text(root.body)).toContain(headline);
    expect(text(root.body)).not.toContain(LANDING);

    const all = Object.entries(surfaces()).filter(([group]) => group !== "landing");
    for (const headers of [{}, { cookie: sessionCookie }] as Record<string, string>[]) {
      const who = "cookie" in headers ? "signed in" : "anonymous";
      for (const [group, paths] of all) {
        for (const path of paths) {
          for (const method of ["GET", "POST"]) {
            const response = await onHost(activeHost, path, { method, headers });
            const label = `${who} ${method} ${group} ${path}`;
            expect([400, 404, 405], label).toContain(response.status);
            expect(response.headers["set-cookie"], label).toBeUndefined();
            expect(response.body, label).not.toContain(LANDING);
            expect(response.body, label).not.toContain(provider.name);
            expect(text(response.body), label).not.toMatch(/What needs your attention today|Platform sign-in|Climvia Marketplace|Log in to|Create your account/);
          }
        }
      }
    }
  });

  test("its Site's pages are at the root of the host and nothing is served under the platform's /sites path", async () => {
    const home = await onHost(activeHost, "/");
    const links = [...home.body.matchAll(/href="(\/[^"#?]*)"/g)].map(([, href]) => href).filter((href) => !href.startsWith("/_next") && !href.startsWith("/assets/"));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(href, href).not.toMatch(/^\/(sites|listings|marketplace|login|signup|overview|platform-admin)(\/|$)/);
    expect((await onHost(activeHost, `/sites/${siteSlug}`)).status).toBe(404);
  });

  test("a header any client can send chooses nothing: the platform's name in X-Forwarded-Host, Forwarded and the like leaves it the customer's, in either direction", async () => {
    const platform = new URL(ORIGIN).host;
    const forgedAsPlatform = { "x-forwarded-host": platform, forwarded: `host=${platform};proto=https`, "x-original-host": platform, "x-host": platform, "x-forwarded-server": platform };
    const plain = await onHost(activeHost, "/");
    const forged = await onHost(activeHost, "/", { headers: forgedAsPlatform });
    expect(forged.status).toBe(200);
    expect(forged.body).toBe(plain.body);
    for (const path of ["/marketplace", "/login", "/signup", "/platform-admin", "/overview", "/api/session-state"]) expect((await onHost(activeHost, path, { headers: forgedAsPlatform })).status, path).toBe(404);

    const forgedAsCustomer = { "x-forwarded-host": activeHost, forwarded: `host=${activeHost}`, "x-original-host": activeHost, "x-host": activeHost, "x-forwarded-server": activeHost };
    const landing = await onPlatform("/", { headers: forgedAsCustomer });
    expect(text(landing.body)).toContain(LANDING);
    expect(text(landing.body)).not.toContain(headline);
    expect((await onPlatform("/login", { headers: forgedAsCustomer })).status).toBe(200);
    expect((await onPlatform("/marketplace", { headers: forgedAsCustomer })).status).toBe(200);
  });
});

/* ───────────────────────────── a name that is not an active claim ───────────────────────────── */

test.describe("a name that is not an active claim", () => {
  test("pending, unknown, a lookalike of the platform's name and a name nobody holds are a plain not found at every path, including the root", async () => {
    const names = [pendingHost, uniqueHost("mxnobody"), `localhost.example.test`, `${new URL(ORIGIN).hostname}.evil.example.test`, `xn--bcher-kva.example.test`];
    const paths = ["/", ...Object.values(surfaces()).flat()];
    for (const host of names) {
      for (const path of paths) {
        const response = await onHost(host, path);
        expect([400, 404], `${host} ${path}`).toContain(response.status);
        expect(response.body, `${host} ${path}`).not.toContain(headline);
        expect(response.body, `${host} ${path}`).not.toContain(LANDING);
        expect(response.headers["set-cookie"], `${host} ${path}`).toBeUndefined();
      }
    }
  });

  test("a Host that is not a name at all is refused, whatever the path", async () => {
    for (const host of ["exa mple.com", "http://example.com", "a..b", "example.com/evil", "-bad.example.test", "bad-.example.test", "ex%61mple.com", "a".repeat(300)]) {
      for (const path of ["/", "/marketplace", "/login"]) {
        const response = await rawRequest(ORIGIN, path, { host });
        expect([400, 404], `${host.slice(0, 30)} ${path}`).toContain(response.status);
        expect(response.body, host.slice(0, 30)).not.toContain(LANDING);
      }
    }
  });
});
