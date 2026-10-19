/**
 * Phase 19A, who gets into the platform console and who does not, asked over HTTP the way a person, a script or a forged request would ask:
 * no session, every kind of workspace member, an owner of several businesses, a platform administrator, one whose authority was just taken away,
 * a request that merely CLAIMS authority, and the customer-domain door. And what the workspace's own pages carry: none of the console.
 */
import { randomBytes } from "node:crypto";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { anonymous, makeBusiness, ORIGIN, signedIn } from "./assets-helpers";
import { insertActiveClaim, rawRequest, uniqueHost } from "./domain-helpers";
import { CONSOLE_PATHS, grantPlatformAdmin, joinBusiness, makeAccount, makePlatformAdmin, revokePlatformAdmin } from "./platform-admin-helpers";

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

let sequence = 0;
/** A client address no other request uses (sign-in is rate limited per address). */
const address = () => `fd00:${process.pid.toString(16)}:${randomBytes(2).toString("hex")}:${(sequence += 1).toString(16)}::1`;

const LOGIN = "/platform-admin/login";
/** How many redirects an RSC request follows: Next answers one with no valid `_rsc` cache-buster by redirecting to the address that has it. */
const FLIGHT_REDIRECTS = 2;
/** The request as a browser navigation sends it, and as the router's own fetch sends it. */
const HEADER_SETS: Record<string, string>[] = [{}, { RSC: "1" }];
/**
 * What only the console's own frame and data carry. (A page's static title can appear in the head of the not-found page a non-administrator gets,
 * and the requested address is in its route tree; neither is console content, so neither is listed.)
 */
const CONSOLE_WORDS = /Super administrator|id="platform-main"|platform-admin\/(organizations|users|marketplace|reviews|system)"/;

test.describe("anonymous", () => {
  test("every console address sends a visitor with no session to the platform sign-in, and shows nothing of the console", async () => {
    const business = await makeBusiness("p19anon", owner.db);
    const api = await anonymous(address());
    try {
      for (const path of [...CONSOLE_PATHS, `/platform-admin/organizations/${business.organizationId}`, "/platform-admin/organizations?q=apex", "/platform-admin/marketplace?page=2", "/platform-admin/nothing-here"]) {
        for (const headers of HEADER_SETS) {
          const response = await api.get(path, { maxRedirects: 0, headers });
          expect(response.status(), `${path} ${JSON.stringify(headers)}`).toBe(307);
          expect(new URL(response.headers().location, ORIGIN).pathname, path).toBe(LOGIN);
          expect(await response.text(), path).not.toMatch(CONSOLE_WORDS);
        }
      }
    } finally {
      await api.dispose();
    }
  });

  test("the sign-in page is open, carries the ordinary sign-in form, is not indexed, and is not cached", async () => {
    const api = await anonymous(address());
    try {
      const response = await api.get(LOGIN, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain("Platform sign-in");
      expect(html).toMatch(/type="password"/);
      expect(html).toMatch(/<meta name="robots" content="noindex/);
      expect(response.headers()["cache-control"]).toMatch(/no-store|no-cache|private/);
      expect(html).not.toMatch(CONSOLE_WORDS);
    } finally {
      await api.dispose();
    }
  });

  test("a forged session cookie passes the early redirect and is stopped at the page", async () => {
    const api = await anonymous(address());
    try {
      const response = await api.get("/platform-admin", { maxRedirects: 0, headers: { cookie: "better-auth.session_token=not-a-real-session.signature" } });
      // The proxy only looks for a cookie; the page asks the database.
      expect([307, 404]).toContain(response.status());
      expect(await response.text()).not.toMatch(CONSOLE_WORDS);
    } finally {
      await api.dispose();
    }
  });
});

test.describe("signed in, but not a platform administrator", () => {
  test("every kind of workspace member, and a person with no business, gets the same 'not found' for every console address", async () => {
    const business = await makeBusiness("p19member", owner.db);
    const second = await makeBusiness("p19second", owner.db);
    // An owner of every business on the platform that exists for this test.
    await joinBusiness(owner.db, second.organizationId, business.owner.userId, "owner");
    const plain = await makeAccount("p19plain", owner.db);
    const people = [
      { who: "owner", email: business.owner.email },
      { who: "admin", email: business.admin.email },
      { who: "member", email: business.member.email },
      { who: "owner of several businesses", email: business.owner.email },
      { who: "account with no business", email: plain.email },
    ];
    // What an address that does not exist answers, to compare with.
    const probe = await signedIn(business.member.email, address());
    const missing = await probe.get("/platform-admin/there-is-no-such-page", { maxRedirects: 0 });
    expect(missing.status()).toBe(404);
    await probe.dispose();

    for (const person of people) {
      const api = await signedIn(person.email, address());
      try {
        for (const path of [...CONSOLE_PATHS, `/platform-admin/organizations/${business.organizationId}`, "/platform-admin/organizations?q=a"]) {
          for (const headers of HEADER_SETS) {
            const response = await api.get(path, { maxRedirects: headers.RSC ? FLIGHT_REDIRECTS : 0, headers });
            const text = await response.text();
            if (headers.RSC) {
              // The router's own request: "not found" travels inside the payload as an error digest, not as the status.
              expect(text, `${person.who} ${path} (RSC)`).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
            } else {
              expect(response.status(), `${person.who} ${path}`).toBe(404);
            }
            expect(text, `${person.who} ${path}`).not.toMatch(CONSOLE_WORDS);
            expect(text, `${person.who} ${path}`).not.toContain(business.owner.email);
          }
        }
        // The sign-in page shows them the form like anyone: it does not say they were turned away, or that an administrator exists.
        const login = await api.get(LOGIN, { maxRedirects: 0 });
        expect(login.status(), person.who).toBe(200);
        expect(await login.text()).toContain("Platform sign-in");
      } finally {
        await api.dispose();
      }
    }
  });

  test("claiming authority changes nothing: a role in a cookie, a header, a query string or the workspace preference", async () => {
    const business = await makeBusiness("p19forge", owner.db);
    const victim = await makeBusiness("p19victim", owner.db);
    const forged: { cookies: { name: string; value: string }[]; headers: Record<string, string>; query: string }[] = [
      { cookies: [{ name: "climvia_org", value: victim.organizationId }], headers: {}, query: "" },
      { cookies: [{ name: "platform_role", value: "super_admin" }, { name: "platformAdmin", value: "1" }, { name: "role", value: "super_admin" }], headers: {}, query: "" },
      { cookies: [], headers: { "x-platform-admin": "true", "x-user-role": "super_admin", "x-organization-id": victim.organizationId, "x-forwarded-user": business.owner.email, "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" }, query: "" },
      { cookies: [], headers: {}, query: `?role=super_admin&platformAdmin=1&organizationId=${victim.organizationId}&as=${business.owner.userId}&admin=true` },
    ];
    for (const [index, attempt] of forged.entries()) {
      const api = await signedIn(business.admin.email, address(), ORIGIN, attempt.headers, attempt.cookies);
      try {
        for (const path of CONSOLE_PATHS) {
          const response = await api.get(`${path}${attempt.query}`, { maxRedirects: 0 });
          expect(response.status(), `attempt ${index} ${path}`).toBe(404);
          expect(await response.text()).not.toMatch(CONSOLE_WORDS);
        }
      } finally {
        await api.dispose();
      }
    }
  });

  test("a form field or a JSON body that names a role does not make a Server Action run for a non-administrator", async () => {
    const business = await makeBusiness("p19post", owner.db);
    const api = await signedIn(business.owner.email, address());
    try {
      for (const body of [{ role: "super_admin" }, { platformAdmin: true, listingId: "00000000-0000-4000-8000-000000000000", state: "suspended" }]) {
        const response = await api.post("/platform-admin/marketplace", { maxRedirects: 0, data: body });
        // The page accepts GET; a POST that is not a Server Action call is not a thing it does. And never a success.
        expect([404, 405, 400, 303, 307]).toContain(response.status());
        expect(await response.text()).not.toMatch(CONSOLE_WORDS);
      }
    } finally {
      await api.dispose();
    }
  });
});

test.describe("a platform administrator", () => {
  test("opens every console page with no business at all, and the pages are private, uncached and not indexed", async () => {
    const admin = await makePlatformAdmin("p19open", owner.db, owner.pool);
    expect((await owner.pool.query("select count(*)::int as n from organization_memberships where user_id = $1", [admin.userId])).rows[0].n).toBe(0);
    const business = await makeBusiness("p19detail", owner.db);
    const api = await signedIn(admin.email, address());
    try {
      for (const path of [...CONSOLE_PATHS, `/platform-admin/organizations/${business.organizationId}`, "/platform-admin/organizations?q=zzz-no-such&page=3", "/platform-admin/users?q=%25", "/platform-admin/marketplace?notice=suspended", "/platform-admin/reviews?rating=9"]) {
        const response = await api.get(path, { maxRedirects: 0 });
        expect(response.status(), path).toBe(200);
        expect(response.headers()["cache-control"], path).toMatch(/no-store|no-cache|private/);
        const html = await response.text();
        expect(html, path).toMatch(/<meta name="robots" content="noindex/);
        expect(html, path).toContain("Super administrator");
        expect(html, path).toContain("Sign out");
      }
      // The sign-in page sends an administrator on.
      const login = await api.get(LOGIN, { maxRedirects: 0 });
      expect(login.status()).toBe(307);
      expect(new URL(login.headers().location, ORIGIN).pathname).toBe("/platform-admin");
      // A business that does not exist, or an id that is not one, is "not found", and the admin gets no stack or SQL.
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", "1' or '1'='1", "%00"]) {
        const missing = await api.get(`/platform-admin/organizations/${encodeURIComponent(id)}`, { maxRedirects: 0 });
        expect(missing.status(), id).toBe(404);
        expect(await missing.text(), id).not.toMatch(/invalid input syntax|SQLSTATE|at async|stack/i);
      }
    } finally {
      await api.dispose();
    }
  });

  test("authority and a business are independent: an administrator who owns a business uses both, and when revoked keeps the business and loses the console on the very next request", async () => {
    const business = await makeBusiness("p19both", owner.db);
    await grantPlatformAdmin(owner.pool, business.owner.userId);
    const api = await signedIn(business.owner.email, address());
    try {
      expect((await api.get("/platform-admin", { maxRedirects: 0 })).status()).toBe(200);
      expect((await api.get("/customers", { maxRedirects: 0 })).status()).toBe(200);
      await revokePlatformAdmin(owner.pool, business.owner.userId);
      // Same session, same cookie.
      for (const path of CONSOLE_PATHS) expect((await api.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
      expect((await api.get("/customers", { maxRedirects: 0 })).status()).toBe(200);
      // Granted again: back at once.
      await grantPlatformAdmin(owner.pool, business.owner.userId);
      expect((await api.get("/platform-admin/organizations", { maxRedirects: 0 })).status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test("the console shows an administrator no more than the platform functions return: another business's private records are not in a business page", async () => {
    const admin = await makePlatformAdmin("p19scope", owner.db, owner.pool);
    const business = await makeBusiness("p19scope", owner.db);
    await owner.pool.query("insert into customers (organization_id, slug, name, email) values ($1, 'scope-probe', 'Scope Probe Customer', 'scope.probe@example.test')", [business.organizationId]);
    const api = await signedIn(admin.email, address());
    try {
      const html = await (await api.get(`/platform-admin/organizations/${business.organizationId}`, { maxRedirects: 0 })).text();
      expect(html).toContain(business.owner.email);
      expect(html).not.toContain("Scope Probe Customer");
      expect(html).not.toContain("scope.probe@example.test");
    } finally {
      await api.dispose();
    }
  });
});

test.describe("a customer's domain", () => {
  test("never reaches the console, whoever is signed in", async () => {
    const admin = await makePlatformAdmin("p19host", owner.db, owner.pool);
    const business = await makeBusiness("p19host", owner.db);
    const host = uniqueHost("p19");
    await insertActiveClaim(owner.pool, business.organizationId, host);
    const api = await signedIn(admin.email, address());
    try {
      const cookie = (await api.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
      for (const path of ["/platform-admin", LOGIN, "/platform-admin/organizations", "/platform-admin/system"]) {
        const response = await rawRequest(ORIGIN, path, { host, headers: { cookie } });
        expect(response.status, path).toBe(404);
        expect(response.body, path).not.toMatch(CONSOLE_WORDS);
        // An unclaimed name is no different.
        const stranger = await rawRequest(ORIGIN, path, { host: uniqueHost("stranger"), headers: { cookie } });
        expect(stranger.status, path).toBe(404);
      }
    } finally {
      await api.dispose();
    }
  });
});

test.describe("the workspace carries nothing of the console", () => {
  test("no workspace page, or the code it loads, links to or names the platform console", async () => {
    const business = await makeBusiness("p19tenantui", owner.db);
    // Both a plain owner and a person who IS a platform administrator: even for them the workspace does not advertise the console.
    const admin = await makePlatformAdmin("p19tenantadmin", owner.db, owner.pool);
    await joinBusiness(owner.db, business.organizationId, admin.userId, "owner");
    const scripts = new Set<string>();
    for (const email of [business.owner.email, admin.email]) {
      const api = await signedIn(email, address());
      try {
        for (const path of ["/", "/customers", "/bookings", "/settings", "/marketplace", "/website", "/team", "/analytics"]) {
          const response = await api.get(path, { maxRedirects: 0 });
          expect(response.status(), `${email} ${path}`).toBe(200);
          const html = await response.text();
          expect(html, `${email} ${path}`).not.toMatch(/platform-admin|Super administrator|platform_admins|super_admin/i);
          for (const match of html.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)) scripts.add(match[0]);
          // The page as the router fetches it.
          const flight = await api.get(path, { maxRedirects: FLIGHT_REDIRECTS, headers: { RSC: "1" } });
          expect(flight.status(), `${email} ${path} (RSC)`).toBe(200);
          const flightText = await flight.text();
          expect(flightText.length, `${email} ${path} (RSC)`).toBeGreaterThan(500);
          expect(flightText, `${email} ${path} (RSC)`).not.toMatch(/platform-admin|Super administrator|platform_admins|super_admin/i);
        }
      } finally {
        await api.dispose();
      }
    }
    expect(scripts.size).toBeGreaterThan(5);
    const anon = await anonymous(address());
    try {
      for (const script of scripts) {
        const body = await (await anon.get(script)).text();
        expect(body, script).not.toMatch(/platform-admin|platform_admins|super_admin|app_platform_/);
      }
    } finally {
      await anon.dispose();
    }
  });

  test("the public pages carry none of it either: the home page, the Marketplace and a listing", async () => {
    const admin = await makePlatformAdmin("p19public", owner.db, owner.pool);
    const api = await anonymous(address());
    try {
      for (const path of ["/", "/login", "/signup", "/listings/apex-climate-heating-air", "/sites/apexclimate"]) {
        const response = await api.get(path, { maxRedirects: 0 });
        const html = await response.text();
        expect(html, path).not.toMatch(/platform-admin|Super administrator|super_admin/i);
        expect(html, path).not.toContain(admin.email);
      }
    } finally {
      await api.dispose();
    }
  });
});
