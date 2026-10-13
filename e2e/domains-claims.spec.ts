/**
 * Phase 18B: the life of a custom-domain claim as the application's data layer runs it, committing, on each worker's own copy of the Apex
 * business (the standing Apex and Northstar are never changed): claiming a name, proving ownership through DNS (answers come from the test
 * resolver, never from the internet), activating, choosing the main domain, disabling, removing, handing a name from one Site to another,
 * and the independence of all of it from Templates, Branding and publishing.
 */
import { expect } from "playwright/test";
import { sql } from "drizzle-orm";
import { activateDomain, claimDomain, disableDomain, loadDomainState, removeDomain, setMainDomain } from "../src/db/domain-queries";
import { loadPublicHost } from "../src/db/public-queries";
import { findPrimarySite, publishSite, replaceDraftWithTemplate, unpublishSite, type SiteContext } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { DOMAIN_LIMIT, DOMAIN_MISSING, DOMAIN_NEEDS_VERIFICATION, DOMAIN_STALE, MAX_DOMAINS_PER_SITE, verificationRecordName, verificationRecordValue } from "../src/lib/domain-rules";
import { Refusal } from "../src/lib/refusal";
import { verifyDomainOwnership } from "../src/db/domain-verification";
import { TEST_HOST_CONFIG, publishTxt, setDns, testResolver, uniqueHost } from "./domain-helpers";
import { test } from "./fixtures";
import { Pool } from "pg";

type Tenant = { userId: string; organizationId: string; platformSlug: string };

let admin: Pool;
test.beforeAll(() => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
});
test.afterAll(async () => {
  await admin.end();
});

const run = <T>(tenant: Tenant, work: (ctx: SiteContext) => Promise<T>): Promise<T> =>
  withTenant({ userId: tenant.userId, organizationId: tenant.organizationId }, (tx) => work({ tx, organizationId: tenant.organizationId }));

/** The message of a change the rules refuse, or "accepted". Anything that is not a refusal (a database error) is thrown. */
async function outcome<T>(promise: Promise<T>): Promise<string> {
  try {
    await promise;
    return "accepted";
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
}

/** The constraint a database error violated (the error or its cause), or "other". */
const constraintOf = (error: unknown): string => {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const candidate = current as { code?: string; constraint?: string };
    if (candidate.code && /^23/.test(candidate.code) && candidate.constraint) return candidate.constraint;
  }
  return "other";
};

const siteId = async (tenant: Tenant, slug = "main") => (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug = $2", [tenant.organizationId, slug])).rows[0].id;
const row = async (id: string) => (await admin.query("select hostname, status, is_primary, revision, verification_token, verified_at, activated_at, disabled_at, removed_at, last_checked_at from site_domains where id = $1", [id])).rows[0];

/** Claim a name for a Site and return the claim's id, token and revision. */
async function claim(tenant: Tenant, site: string, hostname = uniqueHost("claim")) {
  const id = await run(tenant, (ctx) => claimDomain(ctx, site, hostname, tenant.userId, TEST_HOST_CONFIG));
  const stored = await row(id);
  return { id, hostname: stored.hostname as string, token: stored.verification_token as string, revision: stored.revision as number };
}

const check = (tenant: Tenant, site: string, id: string, revision: number) =>
  verifyDomainOwnership({ userId: tenant.userId, organizationId: tenant.organizationId }, site, id, revision, testResolver());

/** Claim, publish the record and verify: a verified claim, ready to activate. */
async function verified(tenant: Tenant, site: string, hostname = uniqueHost("ver")) {
  const made = await claim(tenant, site, hostname);
  publishTxt(made.hostname, made.token);
  expect(await check(tenant, site, made.id, made.revision)).toBe("verified");
  return { ...made, revision: (await row(made.id)).revision as number };
}

/** A claim that is active: verified, then activated. */
async function active(tenant: Tenant, site: string, hostname?: string) {
  const made = await verified(tenant, site, hostname);
  await run(tenant, (ctx) => activateDomain(ctx, site, made.id, made.revision));
  return { ...made, revision: (await row(made.id)).revision as number };
}

test.describe("claiming a name", () => {
  test("a claim persists as pending with a token of its own, is read back for a manager with the record to create, and without it for anyone else", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site, ` ${uniqueHost("persist").toUpperCase()}. `);
    expect(await row(made.id)).toMatchObject({ status: "pending_verification", is_primary: false, revision: 1, verified_at: null, activated_at: null });
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Read again later (a reload): the claim, its state, and for a manager the TXT record to create.
    const asManager = await run(workerTenant, (ctx) => loadDomainState(ctx.tx, ctx.organizationId, site, true, "sites.climvia.com"));
    expect(asManager.routingTarget).toBe("sites.climvia.com");
    expect(asManager.domains).toHaveLength(1);
    expect(asManager.domains[0]).toMatchObject({ id: made.id, hostname: made.hostname, status: "pending_verification", isPrimary: false, revision: 1, verifiedAt: null, lastCheckedAt: null });
    expect(asManager.domains[0].verification).toEqual({ recordName: verificationRecordName(made.hostname), recordValue: verificationRecordValue(made.token) });
    // Someone who may only look gets the claim and its state, but never the token.
    const asViewer = await run(workerTenant, (ctx) => loadDomainState(ctx.tx, ctx.organizationId, site, false, null));
    expect(asViewer.domains[0].verification).toBeNull();
    expect(JSON.stringify(asViewer)).not.toContain(made.token);
  });

  test("a name can be claimed once: not twice by the same Site, not by another Site of the business, whatever the spelling", async ({ workerTenant }) => {
    const main = await siteId(workerTenant);
    const commercial = await siteId(workerTenant, "commercial");
    const label = `bü${uniqueHost("idn").split("-")[1].slice(0, 8)}`;
    const made = await claim(workerTenant, main, `${label}.example.test`);
    expect(made.hostname).toMatch(/^xn--b/);
    const spellings = [made.hostname, made.hostname.toUpperCase(), `${made.hostname}.`, `${label.toUpperCase()}.example.test.`, `${label.replace("ü", "ü")}.example.test`];
    for (const site of [main, commercial]) {
      for (const spelling of spellings) {
        const error = await run(workerTenant, (ctx) => claimDomain(ctx, site, spelling, workerTenant.userId, TEST_HOST_CONFIG)).then(() => "accepted", (thrown: unknown) => constraintOf(thrown));
        expect(error, `${spelling} on ${site === main ? "main" : "commercial"}`).toBe("site_domains_hostname_unique");
      }
    }
    expect((await admin.query("select count(*)::int as n from site_domains where hostname = $1", [made.hostname])).rows[0].n).toBe(1);
  });

  test("different names for different Sites of one business are fine, and each belongs to its own Site", async ({ workerTenant }) => {
    const main = await siteId(workerTenant);
    const commercial = await siteId(workerTenant, "commercial");
    const first = await claim(workerTenant, main);
    const second = await claim(workerTenant, commercial);
    const owners = (await admin.query<{ id: string; site_id: string }>("select id, site_id from site_domains where id in ($1, $2) order by hostname", [first.id, second.id])).rows;
    expect(Object.fromEntries(owners.map((owner) => [owner.id, owner.site_id]))).toEqual({ [first.id]: main, [second.id]: commercial });
    expect((await run(workerTenant, (ctx) => loadDomainState(ctx.tx, ctx.organizationId, main, true, null))).domains.map((domain) => domain.id)).toEqual([first.id]);
    expect((await run(workerTenant, (ctx) => loadDomainState(ctx.tx, ctx.organizationId, commercial, true, null))).domains.map((domain) => domain.id)).toEqual([second.id]);
  });

  test("a Site holds a limited number of claims at once, and removing one makes room", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const claims: Awaited<ReturnType<typeof claim>>[] = [];
    for (let index = 0; index < MAX_DOMAINS_PER_SITE; index += 1) claims.push(await claim(workerTenant, site));
    expect(await outcome(run(workerTenant, (ctx) => claimDomain(ctx, site, uniqueHost("over"), workerTenant.userId, TEST_HOST_CONFIG)))).toBe(DOMAIN_LIMIT);
    await run(workerTenant, (ctx) => removeDomain(ctx, site, claims[0].id, claims[0].revision));
    expect(await outcome(run(workerTenant, (ctx) => claimDomain(ctx, site, uniqueHost("room"), workerTenant.userId, TEST_HOST_CONFIG)))).toBe("accepted");
  });

  test("a name that is reserved or not a domain name is refused before anything is stored", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const hostile = ["climvia.com", "api.climvia.com", "localhost", "foo.localhost", "https://x.example.test", "x.example.test/path", "*.example.test", "127.0.0.1", "[::1]", "user@x.example.test", "x.example.test:443", "sites.climvia.com", 42, null, undefined, {}];
    for (const input of hostile) expect(await outcome(run(workerTenant, (ctx) => claimDomain(ctx, site, input, workerTenant.userId, TEST_HOST_CONFIG))), JSON.stringify(input)).not.toBe("accepted");
    expect((await admin.query("select count(*)::int as n from site_domains where site_id = $1", [site])).rows[0].n).toBe(0);
    // The routing target and the application's own names, from configuration, are reserved too.
    const configured = { ...TEST_HOST_CONFIG, customDomainTarget: "edge.example.test", appHosts: ["app.example.test"] };
    for (const name of ["edge.example.test", "x.edge.example.test", "app.example.test"]) {
      expect(await outcome(run(workerTenant, (ctx) => claimDomain(ctx, site, name, workerTenant.userId, configured))), name).not.toBe("accepted");
    }
  });
});

test.describe("proving ownership through DNS", () => {
  test("the right record verifies the claim, once: the stamps are set, the revision moves, and a repeat changes nothing", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site);
    publishTxt(made.hostname, made.token);
    expect(await check(workerTenant, site, made.id, 1)).toBe("verified");
    const after = await row(made.id);
    expect(after).toMatchObject({ status: "verified", revision: 2, is_primary: false });
    expect(after.verified_at).not.toBeNull();
    expect(after.last_checked_at).not.toBeNull();
    // Verifying again (the same screen, another tab, a double click) is a no-op that is not an error.
    expect(await check(workerTenant, site, made.id, 2)).toBe("settled");
    expect(await row(made.id)).toMatchObject({ status: "verified", revision: 2 });
    expect((await row(made.id)).verified_at).toEqual(after.verified_at);
  });

  test("no record, a wrong value, a longer value and another claim's token do not verify; DNS being unreachable changes nothing and is not 'no record'", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site);
    const other = await claim(workerTenant, site);
    const name = verificationRecordName(made.hostname);
    const again = async () => {
      await admin.query("update site_domains set last_checked_at = null where id = $1", [made.id]);
      return check(workerTenant, site, made.id, 1);
    };

    expect(await again()).toBe("not-found");
    setDns(name, [[verificationRecordValue("not-the-token")]]);
    expect(await again()).toBe("wrong-value");
    setDns(name, [[verificationRecordValue(other.token)]]);
    expect(await again()).toBe("wrong-value");
    setDns(name, [[`${verificationRecordValue(made.token)}extra`]]);
    expect(await again()).toBe("wrong-value");
    setDns(name, [[`note: ${verificationRecordValue(made.token)} :end`]]);
    expect(await again()).toBe("wrong-value");
    setDns(name, "timeout");
    expect(await again()).toBe("unavailable");
    setDns(name, "error");
    expect(await again()).toBe("unavailable");
    // None of it moved the claim, and it can be tried again.
    expect(await row(made.id)).toMatchObject({ status: "pending_verification", revision: 1, verified_at: null });
    publishTxt(made.hostname, made.token);
    expect(await again()).toBe("verified");
  });

  test("a record stored in chunks is read as one value, and so is one among several records", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const chunked = await claim(workerTenant, site);
    const value = verificationRecordValue(chunked.token);
    setDns(verificationRecordName(chunked.hostname), [[value.slice(0, 7), value.slice(7, 30), value.slice(30)]]);
    expect(await check(workerTenant, site, chunked.id, 1)).toBe("verified");

    const several = await claim(workerTenant, site);
    setDns(verificationRecordName(several.hostname), [["v=spf1 -all"], [verificationRecordValue("somebody-else")], [verificationRecordValue(several.token)]]);
    expect(await check(workerTenant, site, several.id, 1)).toBe("verified");
  });

  test("checks are rate limited by the claim itself: a second check at once is told to wait, and it holds however many ask", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site);
    expect(await check(workerTenant, site, made.id, 1)).toBe("not-found");
    const stamped = (await row(made.id)).last_checked_at;
    expect(stamped).not.toBeNull();
    expect(await check(workerTenant, site, made.id, 1)).toBe("too-soon");
    // Eight at once (after the wait) reach DNS once between them.
    await admin.query("update site_domains set last_checked_at = null where id = $1", [made.id]);
    publishTxt(made.hostname, made.token);
    const together = await Promise.all(Array.from({ length: 8 }, () => check(workerTenant, site, made.id, 1).catch((error: unknown) => (error instanceof Refusal ? "refused" : "failed"))));
    expect(together.filter((answer) => answer === "verified")).toHaveLength(1);
    expect(together.filter((answer) => answer === "failed")).toHaveLength(0);
    expect(await row(made.id)).toMatchObject({ status: "verified", revision: 2 });
  });

  test("a check for a revision the screen no longer has, an id that is not one, or another business's claim is refused", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site);
    expect(await outcome(check(workerTenant, site, made.id, 9))).toBe(DOMAIN_STALE);
    expect(await outcome(check(workerTenant, site, made.id, "1" as never))).toBe(DOMAIN_STALE);
    expect(await outcome(check(workerTenant, site, "not-an-id", 1))).toBe(DOMAIN_MISSING);
    expect(await outcome(check(workerTenant, site, "00000000-0000-4000-8000-000000000000", 1))).toBe(DOMAIN_MISSING);
    // Northstar's owner, naming this claim and this Site, reaches nothing.
    const taylor = (await admin.query<{ id: string }>("select id from auth_user where email = 'taylor.brooks@northstar.test'")).rows[0].id;
    const northstar = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    expect(await outcome(verifyDomainOwnership({ userId: taylor, organizationId: northstar }, site, made.id, 1, testResolver()))).toBe(DOMAIN_MISSING);
    expect(await row(made.id)).toMatchObject({ status: "pending_verification", revision: 1, last_checked_at: null });
  });

  test("a removed claim can not be checked, and DNS answers for a name never decide for another", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site);
    publishTxt(made.hostname, made.token);
    await run(workerTenant, (ctx) => removeDomain(ctx, site, made.id, 1));
    expect(await outcome(check(workerTenant, site, made.id, 2))).toBe(DOMAIN_MISSING);
    expect((await row(made.id)).status).toBe("removed");
  });
});

test.describe("serving the site", () => {
  test("an unverified claim can not be activated, and a verified one can: the first active domain is the main one and the host then resolves", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await claim(workerTenant, site);
    expect(await outcome(run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, 1)))).toBe(DOMAIN_NEEDS_VERIFICATION);
    expect((await row(made.id)).status).toBe("pending_verification");
    expect(await loadPublicHost(made.hostname)).toBeNull();

    publishTxt(made.hostname, made.token);
    expect(await check(workerTenant, site, made.id, 1)).toBe("verified");
    // A verified claim is still not served until it is activated.
    expect(await loadPublicHost(made.hostname)).toBeNull();
    await run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, 2));
    expect(await row(made.id)).toMatchObject({ status: "active", is_primary: true, revision: 3 });
    expect(await loadPublicHost(made.hostname)).toEqual({ platformSlug: workerTenant.platformSlug, canonicalHost: made.hostname });
    // Activating again is a no-op.
    await run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, 3));
    expect((await row(made.id)).revision).toBe(3);
  });

  test("disabling stops the host resolving at once and ends its being main; re-enabling brings it back; removing releases the name", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await active(workerTenant, site);
    expect(await loadPublicHost(made.hostname)).not.toBeNull();
    await run(workerTenant, (ctx) => disableDomain(ctx, site, made.id, made.revision));
    expect(await row(made.id)).toMatchObject({ status: "disabled", is_primary: false });
    expect(await loadPublicHost(made.hostname)).toBeNull();
    const disabled = (await row(made.id)).revision as number;
    await run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, disabled));
    expect(await loadPublicHost(made.hostname)).not.toBeNull();
    const reenabled = (await row(made.id)).revision as number;
    await run(workerTenant, (ctx) => removeDomain(ctx, site, made.id, reenabled));
    expect(await loadPublicHost(made.hostname)).toBeNull();
    expect(await row(made.id)).toMatchObject({ status: "removed", is_primary: false });
    // The name is free again, for this Site or another, with a new token.
    const again = await claim(workerTenant, await siteId(workerTenant, "commercial"), made.hostname);
    expect(again.token).not.toBe(made.token);
    expect(again.id).not.toBe(made.id);
  });

  test("a Site has one main domain: the next active one is an alias until it is chosen, and choosing hands the role over", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const one = await active(workerTenant, site);
    const two = await active(workerTenant, site);
    expect(await row(one.id)).toMatchObject({ is_primary: true });
    expect(await row(two.id)).toMatchObject({ is_primary: false });
    // Both serve the site; both name the main one as the site's own name.
    expect(await loadPublicHost(two.hostname)).toEqual({ platformSlug: workerTenant.platformSlug, canonicalHost: one.hostname });

    await run(workerTenant, async (ctx) => setMainDomain(ctx, site, two.id, (await row(two.id)).revision, true));
    expect(await row(one.id)).toMatchObject({ is_primary: false });
    expect(await row(two.id)).toMatchObject({ is_primary: true });
    expect(await loadPublicHost(one.hostname)).toEqual({ platformSlug: workerTenant.platformSlug, canonicalHost: two.hostname });
    // Making the Climvia address the main one again clears it, and the domains keep serving.
    await run(workerTenant, async (ctx) => setMainDomain(ctx, site, two.id, (await row(two.id)).revision, false));
    expect((await admin.query("select count(*)::int as n from site_domains where site_id = $1 and is_primary", [site])).rows[0].n).toBe(0);
    expect(await loadPublicHost(two.hostname)).toEqual({ platformSlug: workerTenant.platformSlug, canonicalHost: two.hostname });
    // Only an active domain can be main.
    const pending = await claim(workerTenant, site);
    expect(await outcome(run(workerTenant, (ctx) => setMainDomain(ctx, site, pending.id, 1, true)))).toBe("Only an active domain can be the main address.");
  });

  test("two domains activated at the same moment leave exactly one main domain, whatever the order", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const domains = [await verified(workerTenant, site), await verified(workerTenant, site), await verified(workerTenant, site)];
    const results = await Promise.all(domains.map((made) => run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, made.revision)).then(() => "active", (error: unknown) => String(error))));
    expect(results).toEqual(["active", "active", "active"]);
    expect((await admin.query("select count(*)::int as n from site_domains where site_id = $1 and is_primary", [site])).rows[0].n).toBe(1);
    expect((await admin.query("select count(*)::int as n from site_domains where site_id = $1 and status = 'active'", [site])).rows[0].n).toBe(3);
  });

  test("a screen that is behind can not undo what happened: it can not re-activate what was disabled, restore what was removed, or change a claim it has never seen", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await active(workerTenant, site);
    // The screen was opened when the claim was verified (revision 2). Meanwhile it was activated, disabled and removed elsewhere.
    await run(workerTenant, (ctx) => disableDomain(ctx, site, made.id, made.revision));
    expect(await outcome(run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, 2)))).toBe(DOMAIN_STALE);
    expect(await outcome(run(workerTenant, (ctx) => disableDomain(ctx, site, made.id, 2)))).toBe(DOMAIN_STALE);
    expect(await outcome(run(workerTenant, (ctx) => removeDomain(ctx, site, made.id, 1)))).toBe(DOMAIN_STALE);
    const current = (await row(made.id)).revision as number;
    await run(workerTenant, (ctx) => removeDomain(ctx, site, made.id, current));
    for (const revision of [2, current, current + 1]) {
      expect(await outcome(run(workerTenant, (ctx) => activateDomain(ctx, site, made.id, revision))), `revision ${revision}`).toBe(DOMAIN_MISSING);
    }
    expect((await row(made.id)).status).toBe("removed");
    // A claim of another Site of this business is not found through this Site.
    const elsewhere = await claim(workerTenant, await siteId(workerTenant, "commercial"));
    expect(await outcome(run(workerTenant, (ctx) => activateDomain(ctx, site, elsewhere.id, 1)))).toBe(DOMAIN_MISSING);
  });
});

test.describe("handing a name from one Site to another", () => {
  test("a released name is claimed again with a NEW token; the old record can not prove the new claim, and the old claim resolves nothing", async ({ workerTenant }) => {
    const main = await siteId(workerTenant);
    const commercial = await siteId(workerTenant, "commercial");
    const first = await active(workerTenant, main);
    expect(await loadPublicHost(first.hostname)).not.toBeNull();
    await run(workerTenant, (ctx) => removeDomain(ctx, main, first.id, first.revision));
    expect(await loadPublicHost(first.hostname)).toBeNull();

    const second = await claim(workerTenant, commercial, first.hostname);
    expect(second.hostname).toBe(first.hostname);
    expect(second.token).not.toBe(first.token);
    // The old Site's record is still in DNS. It does not prove the new claim.
    publishTxt(first.hostname, first.token);
    expect(await check(workerTenant, commercial, second.id, 1)).toBe("wrong-value");
    expect(await row(second.id)).toMatchObject({ status: "pending_verification" });
    expect(await loadPublicHost(first.hostname)).toBeNull();
    // The new Site's own record does.
    publishTxt(second.hostname, second.token);
    await admin.query("update site_domains set last_checked_at = null where id = $1", [second.id]);
    expect(await check(workerTenant, commercial, second.id, 1)).toBe("verified");
    // The removed claim stays as history, unchanged and unusable.
    expect(await row(first.id)).toMatchObject({ status: "removed", verification_token: first.token });
    expect(await outcome(run(workerTenant, (ctx) => activateDomain(ctx, main, first.id, first.revision + 1)))).toBe(DOMAIN_MISSING);
  });
});

test.describe("a domain and the rest of the website are separate", () => {
  test("applying a Template does not touch a claim, its token, its state or whether it is main", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await active(workerTenant, site);
    const pending = await claim(workerTenant, site);
    const before = [await row(made.id), await row(pending.id)];
    const draft = (await admin.query<{ revision: number }>("select revision from site_versions where site_id = $1 and status = 'draft'", [site])).rows[0].revision;
    await run(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, "airflow", { confirmReplace: true, expectedRevision: draft }));
    expect([await row(made.id), await row(pending.id)]).toEqual(before);
    expect(await loadPublicHost(made.hostname)).not.toBeNull();
  });

  test("changing Branding does not touch a claim, and changing a claim does not touch Branding", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const brandingOf = async () => (await admin.query("select logo_asset_id, accent, updated_at from organization_branding where organization_id = $1", [workerTenant.organizationId])).rows[0];
    const made = await active(workerTenant, site);
    const brandingBefore = await brandingOf();
    expect(brandingBefore).toBeDefined();
    const claimBefore = await row(made.id);
    await run(workerTenant, (ctx) => ctx.tx.execute(sql`update organization_branding set accent = '#112233' where organization_id = ${workerTenant.organizationId}`));
    expect(await row(made.id)).toEqual(claimBefore);
    expect((await brandingOf()).accent).toBe("#112233");
    const brandingMid = await brandingOf();
    await run(workerTenant, (ctx) => disableDomain(ctx, site, made.id, claimBefore.revision));
    expect(await brandingOf()).toEqual(brandingMid);
  });

  test("publishing and making the site private change what is served, never the claim: an active domain of a private site finds nothing, and finds the site again when it is published", async ({ workerTenant }) => {
    const site = await siteId(workerTenant);
    const made = await active(workerTenant, site);
    expect(await loadPublicHost(made.hostname)).not.toBeNull();
    await run(workerTenant, (ctx) => unpublishSite(ctx, site));
    expect(await row(made.id)).toMatchObject({ status: "active", is_primary: true });
    expect(await loadPublicHost(made.hostname)).toBeNull();
    const primary = await run(workerTenant, (ctx) => findPrimarySite(ctx.tx, ctx.organizationId));
    expect(primary?.status).toBe("draft");
    await run(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    expect(await loadPublicHost(made.hostname)).toEqual({ platformSlug: workerTenant.platformSlug, canonicalHost: made.hostname });
    expect(await row(made.id)).toMatchObject({ status: "active", is_primary: true });
  });
});
