/**
 * Phase 18C1: the two kinds of endpoint a container deployment depends on, asked of the running (production-built) server.
 *
 *   /health/live, /health/ready   "the process runs" and "the process can serve". Narrow: no session, no tenant data, and nothing in the answer
 *                                 that says why (no error, address, path or setting). Not reachable on a customer's domain.
 *   /internal/tls-allow           the reverse proxy's question before it requests a certificate for a name: yes only for an ACTIVE claim on a
 *                                 PUBLISHED Site, asked with the shared secret; every other answer is the same bare 404.
 *
 * What the real stack adds (Caddy in front, the database stopped and started, an image that refuses a bad configuration) is proved against
 * containers, not here.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { createDraftFromTemplate, publishSite, unpublishSite, type SiteContext } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { makeBusiness, startServer } from "./assets-helpers";
import { insertActiveClaim, rawRequest, uniqueHost, type RawResponse } from "./domain-helpers";
import { setHeadlineOf } from "./draft-edits";

const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3460";
const PORT = new URL(ORIGIN).port;
const TOKEN = process.env.TLS_ASK_TOKEN ?? "";

let pool: ReturnType<typeof adminDb>["pool"];
let db: ReturnType<typeof adminDb>["db"];
test.beforeAll(() => {
  const admin = adminDb();
  pool = admin.pool;
  db = admin.db;
});
test.afterAll(async () => {
  await pool.end();
});

const get = (path: string, options: { host?: string; headers?: Record<string, string>; method?: string } = {}): Promise<RawResponse> => rawRequest(ORIGIN, path, options);
const ask = (domain: string | null, token: string | null = TOKEN, extra = ""): Promise<RawResponse> => {
  const params = [token === null ? "" : `token=${encodeURIComponent(token)}`, domain === null ? "" : `domain=${encodeURIComponent(domain)}`].filter(Boolean).join("&");
  return get(`/internal/tls-allow?${params}${extra}`);
};

/** The headers that could tell one "no" from another, as one comparable string. */
const shape = (response: RawResponse) => JSON.stringify({ status: response.status, body: response.body, cache: response.headers["cache-control"], type: response.headers["content-type"], length: response.headers["content-length"] });

const run = <T>(business: { owner: { userId: string }; organizationId: string }, work: (ctx: SiteContext) => Promise<T>): Promise<T> =>
  withTenant({ userId: business.owner.userId, organizationId: business.organizationId }, (tx) => work({ tx, organizationId: business.organizationId }));

const siteOf = async (organizationId: string) => (await pool.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [organizationId])).rows[0].id;

/** A business with a PUBLISHED site. */
async function publishedBusiness(label: string) {
  const business = await makeBusiness(label, db);
  const site = await siteOf(business.organizationId);
  await run(business, async (ctx) => {
    await createDraftFromTemplate(ctx, site, DEFAULT_TEMPLATE_KEY);
    await setHeadlineOf(ctx, site, `Headline ${randomBytes(3).toString("hex")}`);
    await publishSite(ctx, site, business.owner.userId);
  });
  return { ...business, site };
}

type Status = "pending_verification" | "verified" | "active" | "disabled" | "removed";

/** A claim in exactly the state asked for (the lifecycle constraint decides which timestamps go with which state). */
async function claim(organizationId: string, hostname: string, status: Status): Promise<void> {
  const now = new Date();
  const stamps = {
    verified_at: status === "pending_verification" || status === "removed" ? null : now,
    activated_at: status === "active" || status === "disabled" ? now : null,
    disabled_at: status === "disabled" ? now : null,
    removed_at: status === "removed" ? now : null,
  };
  await pool.query(
    `insert into site_domains (organization_id, site_id, hostname, status, verification_token, verified_at, activated_at, disabled_at, removed_at, is_primary)
     select organization_id, id, $2, $3, $4, $5, $6, $7, $8, false from sites where organization_id = $1 and slug = 'main'`,
    [organizationId, hostname, status, randomBytes(32).toString("base64url"), stamps.verified_at, stamps.activated_at, stamps.disabled_at, stamps.removed_at],
  );
}

/* ───────────────────────────────── liveness and readiness ───────────────────────────────── */

test.describe("/health/live and /health/ready", () => {
  test("the process says it is alive without asking anything else: 200, a version, nothing more, never cached", async () => {
    const response = await get("/health/live");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.body)).toEqual({ status: "ok", version: "development" });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  test("it says it can serve when configuration, database and storage are fit, and names only those three checks", async () => {
    const response = await get("/health/ready");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.body)).toEqual({ status: "ready", version: "development", checks: { config: "ok", database: "ok", storage: "ok" } });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  test("it is for anyone who can reach the port and reveals nothing: no session needed, no address, path, setting or tenant in the answer", async () => {
    const body = (await get("/health/ready", { headers: { cookie: "better-auth.session_token=nonsense" } })).body;
    for (const secret of [process.env.DATABASE_URL ?? "x-no-url", process.env.BETTER_AUTH_SECRET ?? "x-no-secret", process.env.ASSET_LOCAL_DIR ?? "x-no-dir", "postgres", "localhost", "Apex", "climvia_app", "organization"]) {
      expect(body.includes(secret), secret).toBe(false);
    }
    // Other methods are not offered.
    expect((await get("/health/ready", { method: "POST" })).status).toBe(405);
    expect((await get("/health/live", { method: "DELETE" })).status).toBe(405);
  });

  test("on a customer's domain neither exists: they are the site's pages that are not there", async () => {
    const business = await publishedBusiness("health-custom");
    const host = uniqueHost("health");
    await insertActiveClaim(pool, business.organizationId, host);
    for (const path of ["/health/live", "/health/ready", "/health", "/internal/tls-allow", `/internal/tls-allow?token=${TOKEN}&domain=${host}`]) {
      const response = await get(path, { host: `${host}:${PORT}` });
      expect(response.status, path).toBe(404);
      expect(response.body, path).not.toMatch(/"status"|"checks"|"version"/);
    }
  });

  test("a server that can not reach its database is alive and not ready, and says which of the three failed and nothing else", async ({}, testInfo) => {
    test.setTimeout(180_000);
    // Nothing listens on port 1: the connection is refused at once.
    const server = await startServer(3500 + testInfo.parallelIndex, { DATABASE_URL: "postgres://climvia_app:wrong@127.0.0.1:1/none" }, "/health/live");
    try {
      const live = await rawRequest(server.origin, "/health/live");
      expect(live.status).toBe(200);
      const ready = await rawRequest(server.origin, "/health/ready");
      expect(ready.status).toBe(503);
      expect(JSON.parse(ready.body)).toEqual({ status: "unavailable", version: "development", checks: { config: "ok", database: "fail", storage: "ok" } });
      expect(ready.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|postgres|climvia_app|wrong|none/i);
      expect(ready.headers["cache-control"]).toBe("no-store");
    } finally {
      server.stop();
    }
  });

  test("a server whose file storage is not configured is not ready either, whatever the database says", async ({}, testInfo) => {
    test.setTimeout(180_000);
    const server = await startServer(3520 + testInfo.parallelIndex, { ASSET_STORAGE_DRIVER: "s3", AWS_S3_BUCKET: "", AWS_REGION: "" }, "/health/live");
    try {
      const ready = await rawRequest(server.origin, "/health/ready");
      expect(ready.status).toBe(503);
      expect(JSON.parse(ready.body).checks).toEqual({ config: "ok", database: "ok", storage: "fail" });
    } finally {
      server.stop();
    }
  });

  test("a server marked as a production deployment refuses to start on the test settings the browser tests use, and says what is wrong without a value", async () => {
    test.setTimeout(120_000);
    const output: string[] = [];
    const child = spawn("npx", ["next", "start", "-p", "3540"], { shell: true, env: { ...process.env, CLIMVIA_ENV: "production", BETTER_AUTH_URL: "http://localhost:3540" } });
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    try {
      // It EXITS, with a failure: a server that logged the problem and went on running would look "up" to an orchestrator.
      const outcome = await Promise.race([exited, new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), 60_000))]);
      expect(outcome, "the process must stop").toBe(1);
      const text = output.join("");
      expect(text).toContain("The production configuration is not fit to start with");
      for (const name of ["DATABASE_ADMIN_URL", "BETTER_AUTH_URL", "DOMAIN_DNS_RESOLVER", "ASSET_LOCAL_DIR"]) expect(text, name).toContain(name);
      // No value of the environment is in what it printed.
      for (const secret of [process.env.BETTER_AUTH_SECRET, process.env.DATABASE_ADMIN_URL, process.env.DATABASE_URL]) if (secret) expect(text.includes(secret)).toBe(false);
    } finally {
      if (child.pid && process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    }
  });
});

/* ───────────────────────────────── certificate permission ───────────────────────────────── */

test.describe("/internal/tls-allow", () => {
  test("an ACTIVE name on a PUBLISHED site may have a certificate: 200, an empty body, never cached", async () => {
    const business = await publishedBusiness("tls-yes");
    const host = uniqueHost("yes");
    await insertActiveClaim(pool, business.organizationId, host);
    const response = await ask(host);
    expect(response.status).toBe(200);
    expect(response.body).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    // The name is compared as the system compares names: case does not matter.
    expect((await ask(host.toUpperCase())).status).toBe(200);
  });

  test("every other state of a claim is refused: pending, verified, disabled, removed, and a name nobody has claimed", async () => {
    const business = await publishedBusiness("tls-states");
    for (const status of ["pending_verification", "verified", "disabled", "removed"] as const) {
      const host = uniqueHost(status.slice(0, 6));
      await claim(business.organizationId, host, status);
      const response = await ask(host);
      expect(response.status, status).toBe(404);
      expect(response.body, status).toBe("");
    }
    expect((await ask(uniqueHost("nobody"))).status).toBe(404);
  });

  test("an active name is refused while its Site is private: not yet published, and published and then made private again", async () => {
    const draftOnly = await makeBusiness("tls-draft", db);
    const hostA = uniqueHost("draft");
    await insertActiveClaim(pool, draftOnly.organizationId, hostA);
    expect((await ask(hostA)).status).toBe(404);

    const business = await publishedBusiness("tls-private");
    const hostB = uniqueHost("private");
    await insertActiveClaim(pool, business.organizationId, hostB);
    expect((await ask(hostB)).status).toBe(200);
    await run(business, (ctx) => unpublishSite(ctx, business.site));
    expect((await ask(hostB)).status).toBe(404);
    // Published again: allowed again, with nothing else changed.
    await run(business, (ctx) => publishSite(ctx, business.site, business.owner.userId));
    expect((await ask(hostB)).status).toBe(200);
  });

  test("a wrong, missing or empty secret is refused for a name that WOULD be allowed, with the same answer as an unknown name", async () => {
    const business = await publishedBusiness("tls-token");
    const host = uniqueHost("token");
    await insertActiveClaim(pool, business.organizationId, host);
    const unknown = shape(await ask(uniqueHost("unknown")));
    const sameLength = TOKEN.slice(0, -1) + (TOKEN.endsWith("x") ? "y" : "x");
    for (const token of [null, "", "wrong", sameLength, TOKEN + "x", TOKEN.slice(1), TOKEN.toUpperCase()]) {
      const response = await ask(host, token);
      expect(response.status, String(token)).toBe(404);
      expect(shape(response), String(token)).toBe(unknown);
    }
    // The secret is read from the query only: a header, a cookie or a second value does not stand in for it.
    for (const headers of [{ authorization: `Bearer ${TOKEN}` }, { "x-tls-token": TOKEN }, { cookie: `token=${TOKEN}` }] as Record<string, string>[]) {
      expect((await get(`/internal/tls-allow?domain=${host}`, { headers })).status, JSON.stringify(headers)).toBe(404);
    }
    expect((await get(`/internal/tls-allow?token=wrong&token=${TOKEN}&domain=${host}`)).status).toBe(404);
  });

  test("anything that is not one clean hostname is refused, and no input is run as SQL", async () => {
    const business = await publishedBusiness("tls-shape");
    const host = uniqueHost("shape");
    await insertActiveClaim(pool, business.organizationId, host);
    const refused = [null, "", " ", "localhost", "127.0.0.1", "[::1]", "a..b", "a b.example.test", `${host}/x`, `${host}:443`, `${host}?x=1`, `*.${host}`, `${host}%00`, "x".repeat(300) + ".example.test", `${host}'; drop table site_domains; --`, `' or '1'='1`, "\u0000"];
    for (const input of refused) {
      const response = await ask(input);
      expect(response.status, JSON.stringify(input)).toBe(404);
      expect(response.body, JSON.stringify(input)).toBe("");
    }
    // A name that merely CONTAINS an active one, or has it as its parent, is not that name.
    for (const input of [`www.${host}`, `x${host}`, host.replace(".example.test", ".example.tes")]) expect((await ask(input)).status, input).toBe(404);
    expect((await pool.query("select count(*)::int as n from site_domains where hostname = $1", [host])).rows[0].n).toBe(1);
    expect((await ask(host)).status).toBe(200);
  });

  test("it answers GET only, and a forged forwarded header changes nothing", async () => {
    const business = await publishedBusiness("tls-method");
    const host = uniqueHost("method");
    await insertActiveClaim(pool, business.organizationId, host);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await get(`/internal/tls-allow?token=${TOKEN}&domain=${host}`, { method })).status, method).toBe(405);
    }
    // Asking about an unknown name "as" the active one does not make the unknown name allowed, and vice versa.
    const other = uniqueHost("other");
    expect((await get(`/internal/tls-allow?token=${TOKEN}&domain=${other}`, { headers: { "x-forwarded-host": host, forwarded: `host=${host}`, "x-original-host": host } })).status).toBe(404);
    expect((await get(`/internal/tls-allow?token=${TOKEN}&domain=${host}`, { headers: { "x-forwarded-host": other, host: `${other}:${PORT}` } })).status).toBe(404);
  });

  test("the answer is about the name alone: it is the same whoever asks, and it leaves no claim, token or tenant in what it says", async () => {
    const business = await publishedBusiness("tls-leak");
    const host = uniqueHost("leak");
    const claimToken = await insertActiveClaim(pool, business.organizationId, host);
    for (const response of [await ask(host), await ask(uniqueHost("none")), await ask(host, "wrong")]) {
      const everything = JSON.stringify(response);
      expect(everything).not.toContain(claimToken);
      expect(everything).not.toContain(business.organizationId);
      expect(everything).not.toContain(business.platformSlug);
    }
  });
});

/* ───────────────────────────────── the database function behind it ───────────────────────────────── */

test.describe("app_tls_eligible", () => {
  test("it runs as its owner with a fixed search path, is executable by the application's role and by nobody else, and reads by an index", async () => {
    const row = (await pool.query<{ prosecdef: boolean; proconfig: string[] | null; provolatile: string; acl: string[] | null }>("select prosecdef, proconfig, provolatile, proacl::text[] as acl from pg_proc where proname = 'app_tls_eligible'")).rows;
    expect(row).toHaveLength(1);
    expect(row[0].prosecdef).toBe(true);
    expect(row[0].provolatile).toBe("s");
    expect(row[0].proconfig).toContain("search_path=public, pg_temp");
    const grants = (row[0].acl ?? []).join(" ");
    expect(grants).toMatch(/climvia_app=X\//);
    expect(grants).not.toMatch(/(^|[ ,{])=X\//);
    const indexes = (await pool.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename = 'site_domains'")).rows.map((index) => index.indexdef);
    expect(indexes.some((definition) => /UNIQUE/i.test(definition) && /\(hostname\)/.test(definition))).toBe(true);
  });

  test("called as the restricted role with no tenant context it answers for an active name, a pending one, an unknown one and nonsense", async () => {
    const business = await publishedBusiness("tls-fn");
    const active = uniqueHost("fn-a");
    const pending = uniqueHost("fn-p");
    await insertActiveClaim(pool, business.organizationId, active);
    await claim(business.organizationId, pending, "pending_verification");
    const { Pool } = await import("pg");
    const runtime = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const answer = async (name: string | null) => (await runtime.query("select app_tls_eligible($1) as eligible", [name])).rows[0].eligible;
      expect(await answer(active)).toBe(true);
      expect(await answer(pending)).toBe(false);
      expect(await answer(uniqueHost("fn-none"))).toBe(false);
      expect(await answer(null)).toBe(false);
      expect(await answer("x".repeat(232))).toBe(false);
      // It is the only way in: with no tenant context the same role sees no row of the table itself (Row Level Security).
      await expect(runtime.query("select hostname from site_domains limit 1")).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await runtime.end();
    }
  });
});
