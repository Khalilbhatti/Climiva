/**
 * The public routes at run time: a published Site or Marketplace listing is the same page, with the same data behind it, for a visitor with
 * no session and for a signed-in member of any business. (provider-boundary.spec.ts holds the same line in the source tree.)
 *
 * Two kinds of proof:
 *
 *   1. On the normal server: the responses a visitor and each kind of signed-in person get are byte-for-byte the same, contain no Draft-only
 *      copy and nothing of anyone's workspace (no person, organization, customer, team or financial data, no provider in the page's JavaScript),
 *      whichever business's public page the person opens.
 *
 *   2. On a second server whose database role can do exactly one thing: run the six public functions (it cannot read a single table).
 *      Every public page still serves, for a visitor and for each signed-in person alike, so a public request provably asks the database nothing
 *      but those functions: no session lookup, no workspace, no Draft. The same server cannot serve a workspace page, which shows the role really
 *      is restricted and the check is not vacuous.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as playwrightRequest, type APIRequestContext } from "playwright/test";
import { Pool } from "pg";
import { withTenant } from "../src/db/tenant";
import { NORTHSTAR_CUSTOMERS, NORTHSTAR_TEAM } from "../scripts/db/seed-data/northstar";
import { CUSTOMERS, TEAM } from "./apex-data";
import { insertActiveClaim, rawRequest, uniqueHost } from "./domain-helpers";
import { setHeadlineOf } from "./draft-edits";
import { signInOverHttp } from "./fixtures";
import { ORIGIN, SEED, SEED_PASSWORD, expect, test } from "./saas";

/** Where two bodies first differ, with a little of each around it, so a failure says what changed. */
function firstDifference(a: string, b: string): string {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return `at ${at}: ${JSON.stringify(a.slice(Math.max(0, at - 60), at + 120))} against ${JSON.stringify(b.slice(Math.max(0, at - 60), at + 120))}`;
}

type Viewer = "anonymous" | "alex" | "jamie" | "taylor" | "casey";
const VIEWERS: Viewer[] = ["anonymous", "alex", "jamie", "taylor", "casey"];
const SIGNED_IN = VIEWERS.filter((viewer): viewer is Exclude<Viewer, "anonymous"> => viewer !== "anonymous");

type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>;
const states: Partial<Record<Viewer, StorageState>> = {};
let admin: Pool;
let ids: { organizations: string[]; users: string[]; northstarListing: string; apexLogo: string };

test.beforeAll(async ({ clientAddresses }) => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  for (const viewer of SIGNED_IN) states[viewer] = await signInOverHttp(SEED[viewer], SEED_PASSWORD, clientAddresses());
  ids = {
    organizations: (await admin.query<{ id: string }>("select id from organizations")).rows.map((row) => row.id),
    users: (await admin.query<{ id: string }>("select id from auth_user")).rows.map((row) => row.id),
    northstarListing: (await admin.query<{ public_slug: string }>("select l.public_slug from marketplace_listings l join organizations o on o.id = l.organization_id where o.slug = 'northstar-heating-cooling'")).rows[0].public_slug,
    apexLogo: (await admin.query<{ id: string }>("select b.logo_asset_id::text as id from organization_branding b join organizations o on o.id = b.organization_id where o.slug = 'apex-climate-heating-air'")).rows[0].id,
  };
});
test.afterAll(async () => {
  await admin.end();
});

/** A client for one kind of viewer on one server: nobody, or someone signed in (their own session cookie). */
async function client(origin: string, viewer: Viewer): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: origin, storageState: viewer === "anonymous" ? { cookies: [], origins: [] } : states[viewer] });
}

type Answer = { status: number; body: string };
async function fetchAll(origin: string, viewer: Viewer, paths: string[]): Promise<Map<string, Answer>> {
  const api = await client(origin, viewer);
  try {
    const answers = new Map<string, Answer>();
    for (const path of paths) {
      const response = await api.get(path, { maxRedirects: 0 });
      answers.set(path, { status: response.status(), body: await response.text() });
    }
    return answers;
  } finally {
    await api.dispose();
  }
}

const SERVICE = "annual-cooling-tune-up";
const APEX_SITE = ["/sites/apexclimate", "/sites/apexclimate/services", "/sites/apexclimate/about", "/sites/apexclimate/contact", "/sites/apexclimate/booking", `/sites/apexclimate/booking/${SERVICE}`];
const NORTHSTAR_SITE = ["/sites/northstar", "/sites/northstar/services"];
const NOT_FOUND = ["/sites/nobody", "/sites/apexclimate/no-such-page", "/sites/apexclimate/a/b/c", "/sites", "/listings", "/listings/nobody", "/listings/apex-climate-heating-air/extra"];
/** A Service the Site does not offer is its own page ("Service not found"), found at the Site's address. */
const MISSING_SERVICE = ["/sites/apexclimate/booking/no-such-service"];
const listings = () => ["/listings/apex-climate-heating-air", `/listings/${ids.northstarListing}`];
/** The business's logo is public (it is drawn on its Site and its listing); any other address under /assets is a plain 404. */
const assetPaths = () => [`/assets/${ids.apexLogo}`, "/assets/00000000-0000-4000-8000-000000000000", "/assets/not-an-id"];
const everyPublicPath = () => [...APEX_SITE, ...NORTHSTAR_SITE, ...listings(), ...MISSING_SERVICE, ...NOT_FOUND, ...assetPaths()];

/** What would show that a response carries someone's workspace: people, organizations, the business's own records and the shape of the workspace's data. */
function workspaceMarkers(extra: string[] = []): { label: string; test: (body: string) => boolean }[] {
  const names = [...CUSTOMERS.map((customer) => customer.name), ...TEAM.map((member) => member.name), ...NORTHSTAR_CUSTOMERS.map((customer) => customer.name), ...NORTHSTAR_TEAM.map((member) => member.name)];
  const literals = [
    ...Object.values(SEED),
    ...ids.organizations,
    ...ids.users,
    ...names,
    ...extra,
    "climvia_org",
    "canEditSettings",
    "hasSampleData",
    "capabilities",
  ];
  return [
    ...literals.map((literal) => ({ label: literal, test: (body: string) => body.includes(literal) })),
    ...["financials", "operations", "maintenance", "marketing", "reporting"].map((key) => ({ label: `the workspace's "${key}" data`, test: (body: string) => new RegExp(`\\\\?"${key}\\\\?"\\s*:`).test(body) })),
  ];
}

function expectNoWorkspace(path: string, viewer: Viewer, body: string, extra: string[] = []) {
  const found = workspaceMarkers(extra).filter((marker) => marker.test(body)).map((marker) => marker.label);
  expect(found, `${viewer} on ${path}`).toEqual([]);
}

test.describe("a published Site or listing is the same page for a visitor and for anyone signed in", () => {
  test("a visitor with no session gets the published site, its pages, its booking page, the listing, and one plain not found", async () => {
    const answers = await fetchAll(ORIGIN, "anonymous", everyPublicPath());
    for (const path of [...APEX_SITE, ...NORTHSTAR_SITE, ...listings()]) expect(answers.get(path)?.status, path).toBe(200);
    for (const path of NOT_FOUND) expect(answers.get(path)?.status, path).toBe(404);
    expect(answers.get(MISSING_SERVICE[0])?.body).toContain("Service not found");
    expect(answers.get("/sites/apexclimate")?.body).toContain("Heating &amp; cooling service when you need it.");
    expect(answers.get("/listings/apex-climate-heating-air")?.body).toContain("Apex Climate Heating &amp; Air");
    for (const path of NOT_FOUND) expect(answers.get(path)?.body, path).toContain("find that page");
  });

  test("a signed-in member of any business also gets them: the same status for every address, found or not", async () => {
    const anonymous = await fetchAll(ORIGIN, "anonymous", everyPublicPath());
    for (const viewer of SIGNED_IN) {
      const answers = await fetchAll(ORIGIN, viewer, everyPublicPath());
      for (const [path, answer] of answers) expect(answer.status, `${viewer} ${path}`).toBe(anonymous.get(path)!.status);
    }
  });

  test("and they get the very same page: byte for byte what a visitor is sent, for the Site, its booking page, the listing and every not found", async () => {
    const anonymous = await fetchAll(ORIGIN, "anonymous", everyPublicPath());
    for (const viewer of SIGNED_IN) {
      const answers = await fetchAll(ORIGIN, viewer, everyPublicPath());
      for (const [path, answer] of answers) expect(answer.body === anonymous.get(path)!.body, `${viewer} is sent a different ${path} from a visitor`).toBe(true);
    }
  });

  test("none of it carries anyone's workspace: no person, organization, customer, team, financial or provider data, whoever is signed in", async () => {
    for (const viewer of VIEWERS) {
      const answers = await fetchAll(ORIGIN, viewer, everyPublicPath());
      for (const [path, answer] of answers) expectNoWorkspace(path, viewer, answer.body);
    }
  });

  test("the Marketplace listing is the same for everyone, and carries no private state", async () => {
    const anonymous = await fetchAll(ORIGIN, "anonymous", listings());
    for (const viewer of SIGNED_IN) {
      const answers = await fetchAll(ORIGIN, viewer, listings());
      for (const [path, answer] of answers) {
        expect(answer.status, `${viewer} ${path}`).toBe(200);
        expect(answer.body === anonymous.get(path)!.body, `${viewer} is sent a different ${path} from a visitor`).toBe(true);
        expectNoWorkspace(path, viewer, answer.body);
      }
    }
  });

  test("a Draft is never in a public response, even for the business's own signed-in owner: only the signed-in preview shows it", async ({ workerTenant }) => {
    const marker = `Draft only ${randomBytes(4).toString("hex")}`;
    const site = (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId])).rows[0].id;
    await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => setHeadlineOf({ tx, organizationId: workerTenant.organizationId }, site, marker));
    const paths = [`/sites/${workerTenant.platformSlug}`, `/sites/${workerTenant.platformSlug}/services`, `/sites/${workerTenant.platformSlug}/booking`];
    const owner = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState });
    const visitor = await client(ORIGIN, "anonymous");
    try {
      for (const path of paths) {
        const asOwner = await owner.get(path);
        const asVisitor = await visitor.get(path);
        expect(asOwner.status(), path).toBe(200);
        const [ownerBody, visitorBody] = [await asOwner.text(), await asVisitor.text()];
        expect(ownerBody, `the owner's ${path}`).not.toContain(marker);
        expect(visitorBody, `the visitor's ${path}`).not.toContain(marker);
        expect(ownerBody === visitorBody, `the owner is sent a different ${path} from a visitor`).toBe(true);
        expectNoWorkspace(path, "alex", ownerBody, [workerTenant.userId, workerTenant.organizationId, workerTenant.email]);
      }
      // Other businesses' people see no Draft of this business either.
      for (const viewer of SIGNED_IN) expect((await fetchAll(ORIGIN, viewer, paths)).get(paths[0])!.body, viewer).not.toContain(marker);
      // The positive control: the owner's own signed-in preview does have it, and a visitor cannot open the preview at all.
      expect(await (await owner.get("/website/preview")).text()).toContain(marker);
      const blocked = await visitor.get("/website/preview", { maxRedirects: 0 });
      expect(blocked.status()).toBe(307);
      expect(blocked.headers().location).toContain("/login");
      expect(await blocked.text()).not.toContain(marker);
    } finally {
      await owner.dispose();
      await visitor.dispose();
    }
  });

  test("a member of one business opening another business's public pages is sent only that business's public page, never their own workspace and never theirs of the other", async ({ workerTenant }) => {
    const marker = `Own Draft ${randomBytes(4).toString("hex")}`;
    const site = (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId])).rows[0].id;
    await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => setHeadlineOf({ tx, organizationId: workerTenant.organizationId }, site, marker));
    // Northstar's owner opens Apex's site and listing: Apex's public projection, nothing of Northstar's workspace.
    const taylorOnApex = await fetchAll(ORIGIN, "taylor", [...APEX_SITE, "/listings/apex-climate-heating-air"]);
    const anonymous = await fetchAll(ORIGIN, "anonymous", [...APEX_SITE, "/listings/apex-climate-heating-air"]);
    for (const [path, answer] of taylorOnApex) {
      expect(answer.body === anonymous.get(path)!.body, `Taylor is sent a different ${path} from a visitor`).toBe(true);
      expectNoWorkspace(path, "taylor", answer.body);
    }
    // Apex's owner (and the owner of a copy of Apex with a Draft of its own) opens Northstar's: Northstar's public projection, nothing of Apex's.
    const northstar = [...NORTHSTAR_SITE, `/listings/${ids.northstarListing}`];
    const northstarAnonymous = await fetchAll(ORIGIN, "anonymous", northstar);
    for (const viewer of ["alex", "casey"] as const) {
      for (const [path, answer] of await fetchAll(ORIGIN, viewer, northstar)) {
        expect(answer.body === northstarAnonymous.get(path)!.body, `${viewer} is sent a different ${path} from a visitor`).toBe(true);
        expectNoWorkspace(path, viewer, answer.body);
      }
    }
    const owner = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState });
    try {
      for (const path of northstar) {
        const body = await (await owner.get(path)).text();
        expect(body === northstarAnonymous.get(path)!.body, `the copy's owner is sent a different ${path} from a visitor`).toBe(true);
        expect(body).not.toContain(marker);
        expectNoWorkspace(path, "alex", body, [workerTenant.userId, workerTenant.organizationId, workerTenant.email]);
      }
    } finally {
      await owner.dispose();
    }
  });

  test("no workspace provider is in the JavaScript a public page loads, for a visitor or anyone signed in; a workspace page does load them", async () => {
    const chunkUrls = (html: string) => [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s<>]+\.js/g)].map((match) => match[0]))];
    const scriptsOf = async (html: string) => (await Promise.all(chunkUrls(html).map(async (url) => (await fetch(`${ORIGIN}${url}`)).text()))).join("\n");
    const PROVIDER = /must be used inside </;
    for (const viewer of VIEWERS) {
      for (const path of ["/sites/apexclimate", `/sites/apexclimate/booking/${SERVICE}`, "/listings/apex-climate-heating-air", "/sites/nobody"]) {
        const answer = (await fetchAll(ORIGIN, viewer, [path])).get(path)!;
        const scripts = await scriptsOf(answer.body);
        expect(chunkUrls(answer.body).length, `${viewer} ${path} loads scripts`).toBeGreaterThan(0);
        expect(PROVIDER.test(scripts), `${viewer}: ${path} loads a workspace provider`).toBe(false);
      }
    }
    // The control: the same signed-in person's workspace page does.
    const workspace = (await fetchAll(ORIGIN, "alex", ["/"])).get("/")!;
    expect(workspace.status).toBe(200);
    expect(PROVIDER.test(await scriptsOf(workspace.body))).toBe(true);
    // And its page carries the workspace the providers were given.
    expect(workspace.body).toContain(SEED.alex);
  });

  test("the Draft previews are still the business's own: a visitor is sent to log in, and a member of another business is shown their own, never this one's", async ({ workerTenant }) => {
    const marker = `Preview Draft ${randomBytes(4).toString("hex")}`;
    const site = (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId])).rows[0].id;
    await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => setHeadlineOf({ tx, organizationId: workerTenant.organizationId }, site, marker));
    const visitor = await client(ORIGIN, "anonymous");
    const taylor = await client(ORIGIN, "taylor");
    const owner = await playwrightRequest.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState });
    try {
      for (const path of ["/website/preview", "/website/preview/services", "/marketplace/preview", "/website/builder"]) {
        const blocked = await visitor.get(path, { maxRedirects: 0 });
        expect(blocked.status(), path).toBe(307);
        expect(blocked.headers().location, path).toContain("/login");
      }
      const own = await (await taylor.get("/website/preview")).text();
      expect(own, "Taylor's preview is Taylor's own").toContain("Northstar");
      expect(own).not.toContain(marker);
      expect(await (await owner.get("/website/preview")).text()).toContain(marker);
      // The Builder still needs a member who may manage the website to write, and any member to look.
      expect((await owner.get("/website/builder")).status()).toBe(200);
    } finally {
      await visitor.dispose();
      await taylor.dispose();
      await owner.dispose();
    }
  });
});

/* ───────────────────────── a server that can only run the six public functions ───────────────────────── */

test.describe("a server whose database role can run the six public functions and nothing else", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let role: string;
  let probeOrigin: string;
  let probeUrl: string;
  let server: ChildProcess | undefined;

  test.beforeAll(async ({}, testInfo) => {
    const port = 3470 + testInfo.parallelIndex;
    probeOrigin = `http://localhost:${port}`;
    role = `climvia_probe_w${testInfo.parallelIndex}`;
    const password = randomBytes(12).toString("hex");
    const database = new URL(process.env.DATABASE_ADMIN_URL!).pathname.slice(1);
    const existing = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
    if (existing.rowCount) {
      await admin.query(`drop owned by ${role}`);
      await admin.query(`drop role ${role}`);
    }
    await admin.query(`create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole nobypassrls`);
    await admin.query(`grant connect on database "${database}" to ${role}`);
    await admin.query(`grant usage on schema public to ${role}`);
    await admin.query(`do $$ declare f record; begin for f in select oid::regprocedure as sig from pg_proc where proname in ('app_public_site', 'app_public_listing', 'app_public_create_booking', 'app_public_asset', 'app_public_domain', 'app_public_site_domain') loop execute format('grant execute on function %s to ${role}', f.sig); end loop; end $$`);

    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    url.username = role;
    url.password = password;
    probeUrl = url.toString();
    // Both addresses are the restricted role's: the owner credential is not in this server's environment at all.
    server = spawn("npx", ["next", "start", "-p", String(port)], { shell: true, stdio: "ignore", env: { ...process.env, DATABASE_URL: probeUrl, DATABASE_ADMIN_URL: probeUrl, BETTER_AUTH_URL: probeOrigin } });
    const isUp = async () => {
      try {
        return (await fetch(`${probeOrigin}/login`)).status === 200;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; attempt < 90 && !(await isUp()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await isUp(), "the restricted server started").toBe(true);
  });

  test.afterAll(async () => {
    if (server?.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      else server.kill("SIGTERM");
    }
    const existing = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
    if (existing.rowCount) {
      await admin.query(`drop owned by ${role}`);
      await admin.query(`drop role ${role}`);
    }
  });

  test("the role can run the public functions and cannot read a table, the session or the Draft", async () => {
    const pool = new Pool({ connectionString: probeUrl, max: 1 });
    try {
      expect((await pool.query("select app_public_site('apexclimate', '') is not null as ok")).rows[0].ok).toBe(true);
      for (const table of ["organizations", "auth_session", "auth_user", "organization_memberships", "site_versions", "site_pages", "site_sections", "customers", "bookings", "services", "profiles"]) {
        await expect(pool.query(`select 1 from ${table} limit 1`), table).rejects.toMatchObject({ code: "42501" });
      }
      await expect(pool.query("select app_take_number('00000000-0000-0000-0000-000000000000', 'booking')")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await pool.end();
    }
  });

  test("every public page serves from it, for a visitor and for everyone signed in, exactly as it does on the normal server", async () => {
    const normal = await fetchAll(ORIGIN, "anonymous", everyPublicPath());
    for (const viewer of VIEWERS) {
      const answers = await fetchAll(probeOrigin, viewer, everyPublicPath());
      for (const [path, answer] of answers) {
        expect(answer.status, `${viewer} ${path}`).toBe(normal.get(path)!.status);
        expect(answer.body === normal.get(path)!.body, `${viewer} is sent a different ${path} by the restricted server: ${firstDifference(normal.get(path)!.body, answer.body)}`).toBe(true);
      }
    }
  });

  test("a customer's own domain is served by it as well: the Host is resolved through app_public_domain alone, and the page is the one the normal server sends", async ({ workerTenant }) => {
    const host = uniqueHost("probe");
    await insertActiveClaim(admin, workerTenant.organizationId, host);
    const [normal, restricted] = await Promise.all([rawRequest(ORIGIN, "/services", { host }), rawRequest(probeOrigin, "/services", { host })]);
    expect(normal.status).toBe(200);
    expect(restricted.status).toBe(200);
    expect(restricted.body).toBe(normal.body);
    // A name nobody has activated is a plain "not found" there too.
    expect((await rawRequest(probeOrigin, "/", { host: uniqueHost("nobody") })).status).toBe(404);
  });

  test("the same server cannot serve a workspace page, a Draft preview or the Builder to anyone: the check is not vacuous", async () => {
    for (const viewer of SIGNED_IN) {
      const api = await client(probeOrigin, viewer);
      try {
        for (const path of ["/", "/customers", "/website/builder", "/website/preview", "/marketplace/preview"]) {
          const response = await api.get(path, { maxRedirects: 0 });
          const body = await response.text();
          expect(response.status() === 200 && /Website Builder|Workspace Overview|Customers/.test(body), `${viewer} was served ${path} by the restricted server`).toBe(false);
          for (const name of CUSTOMERS.map((customer) => customer.name)) expect(body, `${viewer} ${path}`).not.toContain(name);
        }
      } finally {
        await api.dispose();
      }
    }
  });
});
