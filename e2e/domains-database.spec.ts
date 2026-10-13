/**
 * Phase 18B: custom domains at the DATABASE, independent of the application code.
 *
 * Like website-database.spec.ts, this connects to the freshly migrated and seeded test database as the restricted runtime role the app uses
 * (`climvia_app`, DATABASE_URL), sets the transaction-local context the way src/db/tenant.ts does, and checks that PostgreSQL itself keeps
 * businesses apart and keeps a claim honest: Row Level Security for who may read and write, column grants for what may change, the composite
 * foreign key for which Site a claim may belong to, the transition guard for which moves a claim may make, CHECK constraints and unique
 * indexes for what a claim may look like and who may hold a name. Nearly every test runs in a transaction that is rolled back; the ones that
 * need two connections to race commit, on the worker's own copy of the Apex business, which is put back before every test.
 */
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "./fixtures";
import { uniqueHost } from "./domain-helpers";

const SEED = {
  alex: "alex.morgan@apex.test", // Apex owner
  jamie: "jamie.rivera@apex.test", // Apex member
  taylor: "taylor.brooks@northstar.test", // Northstar owner
  casey: "casey.nguyen@climvia.test", // admin in both
};

let app: Pool;
let admin: Pool;
const user: Record<string, string> = {};
let apex = "";
let northstar = "";
const site: Record<string, string> = {};

const idOf = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0].id;

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  for (const [key, email] of Object.entries(SEED)) user[key] = await idOf("select id from auth_user where email = $1", [email]);
  apex = await idOf("select id from organizations where slug = 'apex-climate-heating-air'", []);
  northstar = await idOf("select id from organizations where slug = 'northstar-heating-cooling'", []);
  site.apexMain = await idOf("select id from sites where organization_id = $1 and slug = 'main'", [apex]);
  site.apexCommercial = await idOf("select id from sites where organization_id = $1 and slug = 'commercial'", [apex]);
  site.northstarMain = await idOf("select id from sites where organization_id = $1 and slug = 'main'", [northstar]);
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined; constraint?: undefined } | { value?: undefined; error: string; code?: string; constraint?: string };

const failure = (error: unknown): { error: string; code?: string; constraint?: string } => ({
  error: error instanceof Error ? error.message : String(error),
  code: (error as { code?: string }).code,
  constraint: (error as { constraint?: string }).constraint,
});

/** Run `fn` as `userId` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(userId: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await context(client, userId, org);
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const context = (client: PoolClient, userId: string | null, org: string | null) =>
  client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", org ?? ""]);

/** The same through the owner role (no Row Level Security): to check constraints on their own and to set up what only the seed may write. */
async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await admin.connect();
  try {
    await client.query("begin");
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, sql: string, params: unknown[] = []) => (await client.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n;
const PERMISSION = "42501";
const FOREIGN_KEY = "23503";

const token = () => randomBytes(32).toString("base64url");

let savepoints = 0;
/** Try `work` inside its own savepoint: "accepted", or the name of the constraint (or the error code) that refused it. The transaction stays usable. */
async function attemptIn(client: PoolClient, work: () => Promise<unknown>): Promise<string> {
  const name = `attempt_${(savepoints += 1)}`;
  await client.query(`savepoint ${name}`);
  try {
    await work();
    await client.query(`release savepoint ${name}`);
    return "accepted";
  } catch (error) {
    await client.query(`rollback to savepoint ${name}`);
    return (error as { constraint?: string; code?: string }).constraint ?? (error as { code?: string }).code ?? "other";
  }
}

type Row = Record<string, unknown>;
const claimRow = (org: string, siteId: string, userId: string | null, overrides: Row = {}): Row => ({
  organization_id: org,
  site_id: siteId,
  hostname: uniqueHost("db"),
  verification_token: token(),
  ...(userId ? { created_by_user_id: userId } : {}),
  ...overrides,
});

async function insertRow(client: PoolClient, row: Row, returning = "id"): Promise<string> {
  const columns = Object.keys(row);
  const result = await client.query<Record<string, string>>(
    `insert into site_domains (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning ${returning}`,
    columns.map((column) => row[column]),
  );
  return result.rows[0][returning];
}

/** Move a claim through its states as the application would (each move on its own, as the person who owns the business). */
const move = (client: PoolClient, id: string, set: string, params: unknown[] = []) => client.query(`update site_domains set ${set} where id = $1`, [id, ...params]);
const verify = (client: PoolClient, id: string) => move(client, id, "status = 'verified', verified_at = now()");
const activate = (client: PoolClient, id: string, primary = false) => move(client, id, "status = 'active', activated_at = now(), is_primary = $2", [primary]);
const stateOf = async (client: PoolClient, id: string) => (await client.query("select status, is_primary, revision, verified_at is not null as verified, activated_at is not null as activated from site_domains where id = $1", [id])).rows[0];

test.describe("who can read and write a claim", () => {
  test("a business reads its own claims; a member reads them too; another business sees none, with its own context or with a forged one", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const host = uniqueHost("read");
      const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex, { hostname: host }));
      const own = await count(client, "select 1 from site_domains where id = $1", [id]);
      await context(client, user.jamie, apex);
      const member = await count(client, "select 1 from site_domains where id = $1", [id]);
      await context(client, user.taylor, northstar);
      const other = await count(client, "select 1 from site_domains where id = $1", [id]);
      // Taylor names Apex as the active organization, but is not a member of it.
      await context(client, user.taylor, apex);
      const forged = await count(client, "select 1 from site_domains");
      await context(client, null, null);
      const nobody = await count(client, "select 1 from site_domains");
      // Casey is an admin of both businesses: with Northstar active, Apex's claim is still not seen.
      await context(client, user.casey, northstar);
      const otherActive = await count(client, "select 1 from site_domains where id = $1", [id]);
      return { own, member, other, forged, nobody, otherActive };
    });
    expect(result.value).toEqual({ own: 1, member: 1, other: 0, forged: 0, nobody: 0, otherActive: 0 });
  });

  test("a member who may not manage the website cannot claim a name, and neither can someone who is not in the business or has no session", async () => {
    for (const [who, org] of [[user.jamie, apex], [user.taylor, apex], [user.taylor, northstar], [null, null]] as const) {
      const claimed = await as(who, org, (client) => insertRow(client, claimRow(apex, site.apexMain, who)));
      expect(claimed.code, `${who} in ${org}`).toBe(PERMISSION);
    }
    // The owner can; so can an admin.
    expect((await as(user.alex, apex, (client) => insertRow(client, claimRow(apex, site.apexMain, user.alex)))).error).toBeUndefined();
    expect((await as(user.casey, apex, (client) => insertRow(client, claimRow(apex, site.apexMain, user.casey)))).error).toBeUndefined();
  });

  test("a claim is created pending, not main, at the first revision, by the person who is making it", async () => {
    const attempt = (overrides: Row) => as(user.alex, apex, (client) => insertRow(client, claimRow(apex, site.apexMain, user.alex, overrides)));
    expect((await attempt({ status: "active", verified_at: new Date(), activated_at: new Date() })).code).toBe(PERMISSION);
    expect((await attempt({ status: "verified", verified_at: new Date() })).code).toBe(PERMISSION);
    expect((await attempt({ is_primary: true })).code).toBe(PERMISSION);
    expect((await attempt({ revision: 5 })).code).toBe(PERMISSION);
    // Another person's name as the maker, and another business as the owner, are refused.
    expect((await as(user.alex, apex, (client) => insertRow(client, claimRow(apex, site.apexMain, user.jamie)))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => insertRow(client, claimRow(apex, site.apexMain, null)))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => insertRow(client, claimRow(northstar, site.northstarMain, user.alex)))).code).toBe(PERMISSION);
    const ok = await as(user.alex, apex, async (client) => stateOf(client, await insertRow(client, claimRow(apex, site.apexMain, user.alex))));
    expect(ok.value).toMatchObject({ status: "pending_verification", is_primary: false, revision: 1, verified: false, activated: false });
  });

  test("a claim belongs to a Site of the SAME business: another business's Site, or a Site that does not exist, can not be named", async () => {
    // Alex passes every policy for Apex, but names Northstar's Site: the composite foreign key refuses it.
    const crossed = await as(user.alex, apex, (client) => insertRow(client, claimRow(apex, site.northstarMain, user.alex)));
    expect(crossed.code).toBe(FOREIGN_KEY);
    expect(crossed.constraint).toBe("site_domains_site_fk");
    const missing = await as(user.alex, apex, (client) => insertRow(client, claimRow(apex, "00000000-0000-4000-8000-000000000000", user.alex)));
    expect(missing.code).toBe(FOREIGN_KEY);
    // A second Site of the same business is fine.
    expect((await as(user.alex, apex, (client) => insertRow(client, claimRow(apex, site.apexCommercial, user.alex)))).error).toBeUndefined();
  });

  test("only the people who manage the website can change a claim; another business's change reaches nothing", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex));
      const attempt = async (who: string | null, org: string | null) => {
        await context(client, who, org);
        return (await client.query("update site_domains set status = 'verified', verified_at = now() where id = $1", [id])).rowCount;
      };
      const member = await attempt(user.jamie, apex);
      const outsider = await attempt(user.taylor, northstar);
      const forged = await attempt(user.taylor, apex);
      const nobody = await attempt(null, null);
      await context(client, user.alex, apex);
      return { member, outsider, forged, nobody, status: (await stateOf(client, id)).status };
    });
    expect(result.value).toEqual({ member: 0, outsider: 0, forged: 0, nobody: 0, status: "pending_verification" });
  });

  test("a claim can not be deleted by the application, by anyone, and the privileges are the narrow ones", async () => {
    expect((await as(user.alex, apex, (client) => client.query("delete from site_domains"))).code).toBe(PERMISSION);
    expect((await as(user.casey, apex, (client) => client.query("truncate site_domains"))).code).toBe(PERMISSION);
    const updatable = (await admin.query<{ column_name: string }>("select column_name from information_schema.column_privileges where grantee = 'climvia_app' and table_name = 'site_domains' and privilege_type = 'UPDATE' order by column_name")).rows.map((row) => row.column_name);
    expect(updatable).toEqual(["activated_at", "disabled_at", "is_primary", "last_checked_at", "removed_at", "status", "verified_at"]);
    const privileges = (await admin.query<{ privilege_type: string }>("select distinct privilege_type from information_schema.table_privileges where grantee = 'climvia_app' and table_name = 'site_domains' order by 1")).rows.map((row) => row.privilege_type);
    expect(privileges).toEqual(["INSERT", "SELECT"]);
    // The name, the Site, the token and the maker are fixed once the claim exists.
    for (const [column, value] of [["hostname", "other.example.test"], ["site_id", site.apexCommercial], ["organization_id", northstar], ["verification_token", token()], ["created_by_user_id", user.jamie], ["revision", 9]] as const) {
      const changed = await as(user.alex, apex, async (client) => {
        const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex));
        return client.query(`update site_domains set ${column} = $2 where id = $1`, [id, value]);
      });
      expect(changed.code, column).toBe(PERMISSION);
    }
  });
});

test.describe("what a claim may do", () => {
  test("a claim makes only the moves in the state machine: it can not skip verification or leave removed", async () => {
    const walk = await as(user.alex, apex, async (client) => {
      const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex));
      const refused = (set: string, params: unknown[] = []) => attemptIn(client, () => move(client, id, set, params));
      const skipped = [
        await refused("status = 'active', verified_at = now(), activated_at = now()"),
        await refused("status = 'active', activated_at = now()"),
        await refused("status = 'disabled', verified_at = now(), activated_at = now(), disabled_at = now()"),
        await refused("is_primary = true"),
      ];
      await verify(client, id);
      const backwards = [await refused("status = 'pending_verification', verified_at = null"), await refused("verified_at = now() + interval '1 day'")];
      await activate(client, id, true);
      const sideways = [await refused("status = 'verified', activated_at = null"), await refused("status = 'pending_verification', verified_at = null, activated_at = null")];
      await move(client, id, "status = 'disabled', disabled_at = now(), is_primary = false");
      await move(client, id, "status = 'active', activated_at = now(), disabled_at = null, is_primary = false");
      await move(client, id, "status = 'removed', removed_at = now(), is_primary = false");
      const afterRemoval = [await refused("status = 'active', activated_at = now(), removed_at = null"), await refused("last_checked_at = now()"), await refused("status = 'pending_verification'")];
      return { skipped, backwards, sideways, afterRemoval, final: (await stateOf(client, id)).status };
    });
    expect(walk.value).toEqual({
      skipped: ["site_domains_transition", "site_domains_transition", "site_domains_transition", "site_domains_primary_is_active"],
      backwards: ["site_domains_transition", "site_domains_verified_final"],
      sideways: ["site_domains_transition", "site_domains_transition"],
      afterRemoval: ["site_domains_removed_final", "site_domains_removed_final", "site_domains_removed_final"],
      final: "removed",
    });
  });

  test("the revision counts changes to a claim's state, not a DNS check that only stamps the time", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex));
      const first = (await stateOf(client, id)).revision;
      await move(client, id, "last_checked_at = now()");
      const checked = (await stateOf(client, id)).revision;
      await verify(client, id);
      const verified = (await stateOf(client, id)).revision;
      await activate(client, id, true);
      const active = (await stateOf(client, id)).revision;
      return { first, checked, verified, active };
    });
    expect(result.value).toEqual({ first: 1, checked: 1, verified: 2, active: 3 });
  });

  test("a Site has at most one main domain, another Site has its own, and only an active domain can be main", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const one = await insertRow(client, claimRow(apex, site.apexMain, user.alex));
      const two = await insertRow(client, claimRow(apex, site.apexMain, user.alex));
      const other = await insertRow(client, claimRow(apex, site.apexCommercial, user.alex));
      for (const id of [one, two, other]) await verify(client, id);
      const firstMain = await attemptIn(client, () => activate(client, one, true));
      const otherSiteMain = await attemptIn(client, () => activate(client, other, true));
      const secondMain = await attemptIn(client, () => activate(client, two, true));
      const secondAlias = await attemptIn(client, () => activate(client, two, false));
      const swap = await attemptIn(client, () => move(client, two, "is_primary = true"));
      // Stopping the first being main makes room for the second.
      await move(client, one, "is_primary = false");
      const handOver = await attemptIn(client, () => move(client, two, "is_primary = true"));
      return { firstMain, otherSiteMain, secondMain, secondAlias, swap, handOver, mains: await count(client, "select 1 from site_domains where is_primary and site_id = $1", [site.apexMain]) };
    });
    expect(result.value).toEqual({
      firstMain: "accepted",
      otherSiteMain: "accepted",
      secondMain: "site_domains_primary_unique",
      secondAlias: "accepted",
      swap: "site_domains_primary_unique",
      handOver: "accepted",
      mains: 1,
    });
  });
});

test.describe("what a claim looks like (constraints that hold for everyone, the owner role included)", () => {
  const asOwnerInsert = (overrides: Row) =>
    asOwner((client) => insertRow(client, claimRow(apex, site.apexMain, null, overrides)));

  test("only the normalized ASCII form of a name can be stored, and the platform's and development names can not be claimed", async () => {
    for (const hostname of ["UPPER.example.test", "trailing.example.test.", "sháred.example.test", " space.example.test", "*.example.test", "127.0.0.1", "1.2.3.4", "no-dot", "a..b.example.test", "-lead.example.test", "trail-.example.test", "under_score.example.test", "x.123"]) {
      expect((await asOwnerInsert({ hostname })).constraint, hostname).toBe("site_domains_hostname_shape");
    }
    for (const hostname of ["localhost", "climvia.com", "www.climvia.com", "deep.sub.climvia.com", "foo.localhost", "printer.local", "db.internal", "x.invalid", "router.home.arpa", "x.localdomain"]) {
      expect((await asOwnerInsert({ hostname })).constraint, hostname).toMatch(/^site_domains_hostname_(shape|reserved)$/);
    }
    expect((await asOwnerInsert({ hostname: "x".repeat(232) + ".com" })).constraint).toBe("site_domains_hostname_shape");
    for (const hostname of ["notclimvia.com", "climvia.com.evil.test", "xn--bcher-kva.example.test", "a.b.c.example.test"]) expect((await asOwnerInsert({ hostname })).error, hostname).toBeUndefined();
  });

  test("a name is held by one claim at a time across every business, and is free again once that claim is removed", async () => {
    const host = uniqueHost("held");
    const result = await asOwner(async (client) => {
      const attempt = async (row: Row) => {
        await client.query("savepoint s");
        try {
          await insertRow(client, row);
          return "accepted";
        } catch (error) {
          await client.query("rollback to savepoint s");
          return (error as { constraint?: string }).constraint;
        }
      };
      const first = await attempt(claimRow(apex, site.apexMain, null, { hostname: host }));
      const sameSite = await attempt(claimRow(apex, site.apexMain, null, { hostname: host }));
      const otherSite = await attempt(claimRow(apex, site.apexCommercial, null, { hostname: host }));
      const otherBusiness = await attempt(claimRow(northstar, site.northstarMain, null, { hostname: host }));
      await client.query("update site_domains set status = 'removed', removed_at = now() where hostname = $1", [host]);
      const afterRemoval = await attempt(claimRow(northstar, site.northstarMain, null, { hostname: host }));
      const tokens = (await client.query<{ n: number }>("select count(distinct verification_token)::int as n from site_domains where hostname = $1", [host])).rows[0].n;
      return { first, sameSite, otherSite, otherBusiness, afterRemoval, tokens };
    });
    expect(result.value).toEqual({
      first: "accepted",
      sameSite: "site_domains_hostname_unique",
      otherSite: "site_domains_hostname_unique",
      otherBusiness: "site_domains_hostname_unique",
      afterRemoval: "accepted",
      tokens: 2,
    });
  });

  test("a token is 43 base64url characters, belongs to one claim ever, and a removed claim's token is never valid for another", async () => {
    const reused = token();
    expect((await asOwnerInsert({ verification_token: "short" })).constraint).toBe("site_domains_token_format");
    expect((await asOwnerInsert({ verification_token: `${token().slice(0, 42)}!` })).constraint).toBe("site_domains_token_format");
    expect((await asOwnerInsert({ verification_token: token() + "A" })).constraint).toBe("site_domains_token_format");
    const second = await asOwner(async (client) => {
      await insertRow(client, claimRow(apex, site.apexMain, null, { verification_token: reused }));
      await client.query("update site_domains set status = 'removed', removed_at = now() where verification_token = $1", [reused]);
      await client.query("savepoint s");
      return insertRow(client, claimRow(apex, site.apexMain, null, { verification_token: reused })).then(
        () => "accepted",
        (error: { constraint?: string }) => error.constraint,
      );
    });
    expect(second.value).toBe("site_domains_token_unique");
  });

  test("an active domain is verified, and the stamps match the state: nothing can be active without having been verified", async () => {
    const stamped = (overrides: Row) => asOwnerInsert({ hostname: uniqueHost("shape"), ...overrides });
    const now = new Date();
    expect((await stamped({ status: "active", activated_at: now })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "active", verified_at: now })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "verified" })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "pending_verification", verified_at: now })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "verified", verified_at: now, activated_at: now })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "disabled", verified_at: now, activated_at: now })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "removed" })).constraint).toBe("site_domains_lifecycle");
    expect((await stamped({ status: "live" })).constraint).toMatch(/^site_domains_(lifecycle|status)$/);
    expect((await stamped({ status: "active", verified_at: now, activated_at: now, removed_at: now })).constraint).toBe("site_domains_lifecycle");
    // A disabled domain, a verified one and a pending one can not be main.
    expect((await stamped({ status: "verified", verified_at: now, is_primary: true })).constraint).toBe("site_domains_primary_is_active");
    expect((await stamped({ status: "disabled", verified_at: now, activated_at: now, disabled_at: now, is_primary: true })).constraint).toBe("site_domains_primary_is_active");
    expect((await stamped({ is_primary: true })).constraint).toBe("site_domains_primary_is_active");
    expect((await stamped({ revision: 0 })).constraint).toBe("site_domains_revision");
    expect((await stamped({ status: "active", verified_at: now, activated_at: now, is_primary: true })).error).toBeUndefined();
  });
});

test.describe("finding a Site by its name, as a visitor with no session", () => {
  const publicHost = (host: string, client: PoolClient) => client.query<{ found: Record<string, unknown> | null }>("select app_public_domain($1) as found", [host]).then((result) => result.rows[0].found);

  test("only an ACTIVE claim of a PUBLISHED site is found, and the answer is the site's public identity and nothing else", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const host = uniqueHost("public");
      const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex, { hostname: host }));
      const seen: Record<string, unknown> = {};
      await context(client, null, null);
      seen.pending = await publicHost(host, client);
      await context(client, user.alex, apex);
      await verify(client, id);
      await context(client, null, null);
      seen.verified = await publicHost(host, client);
      await context(client, user.alex, apex);
      await activate(client, id, true);
      await context(client, null, null);
      seen.active = await publicHost(host, client);
      seen.uppercase = await publicHost(host.toUpperCase(), client);
      seen.trailingDot = await publicHost(`${host}.`, client);
      seen.long = await publicHost("a".repeat(300), client);
      seen.nothing = await publicHost(null as unknown as string, client);
      await context(client, user.alex, apex);
      await move(client, id, "status = 'disabled', disabled_at = now(), is_primary = false");
      await context(client, null, null);
      seen.disabled = await publicHost(host, client);
      await context(client, user.alex, apex);
      await move(client, id, "status = 'active', activated_at = now(), disabled_at = null, is_primary = true");
      await move(client, id, "status = 'removed', removed_at = now(), is_primary = false");
      await context(client, null, null);
      seen.removed = await publicHost(host, client);
      return seen;
    });
    expect(result.value).toEqual({
      pending: null,
      verified: null,
      active: { platformSlug: "apexclimate", canonicalHost: expect.stringMatching(/^public-[0-9a-f]{8}\.example\.test$/) },
      uppercase: null,
      trailingDot: null,
      long: null,
      nothing: null,
      disabled: null,
      removed: null,
    });
  });

  test("an active claim of a site that is not published is not found, and the answer holds no token, id, organization or status", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const host = uniqueHost("private");
      // The commercial Site is a Draft: private.
      const id = await insertRow(client, claimRow(apex, site.apexCommercial, user.alex, { hostname: host }));
      await verify(client, id);
      await activate(client, id, true);
      await context(client, null, null);
      const privateSite = await publicHost(host, client);
      await context(client, user.alex, apex);
      const published = uniqueHost("published");
      const other = await insertRow(client, claimRow(apex, site.apexMain, user.alex, { hostname: published }));
      await verify(client, other);
      await activate(client, other, true);
      await context(client, null, null);
      const answer = await publicHost(published, client);
      return { privateSite, answer, keys: Object.keys(answer ?? {}).sort(), text: JSON.stringify(answer) };
    });
    expect(result.value?.privateSite).toBeNull();
    expect(result.value?.keys).toEqual(["canonicalHost", "platformSlug"]);
    expect(result.value?.text).not.toMatch(/token|organization|status|id"|draft|created/i);
  });

  test("a site with several active domains answers every one of them, and each says the main one is its canonical name", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const main = uniqueHost("main");
      const alias = uniqueHost("alias");
      const ids: string[] = [];
      for (const hostname of [main, alias]) {
        const id = await insertRow(client, claimRow(apex, site.apexMain, user.alex, { hostname }));
        await verify(client, id);
        ids.push(id);
      }
      await activate(client, ids[0], true);
      await activate(client, ids[1], false);
      await context(client, null, null);
      const viaAlias = await publicHost(alias, client);
      const viaMain = await publicHost(main, client);
      const platform = (await client.query<{ host: string | null }>("select app_public_site_domain('apexclimate') as host")).rows[0].host;
      return { viaAlias, viaMain, platform, main };
    });
    expect(result.value?.viaAlias).toEqual({ platformSlug: "apexclimate", canonicalHost: result.value?.main });
    expect(result.value?.viaMain).toEqual({ platformSlug: "apexclimate", canonicalHost: result.value?.main });
    expect(result.value?.platform).toBe(result.value?.main);
  });

  test("the visitor functions are executable by the application's role and by nobody else, run as their owner and fix their search path", async () => {
    const rows = (await admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; acl: string[] | null }>(
      "select proname, prosecdef, proconfig, proacl::text[] as acl from pg_proc where proname in ('app_public_domain', 'app_public_site_domain') order by proname",
    )).rows;
    expect(rows.map((row) => row.proname)).toEqual(["app_public_domain", "app_public_site_domain"]);
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.proconfig, row.proname).toContain("search_path=public, pg_temp");
      const grants = (row.acl ?? []).join(" ");
      expect(grants, row.proname).toMatch(/climvia_app=X\//);
      expect(grants, row.proname).not.toMatch(/(^|[ ,{])=X\//);
    }
  });

  test("a public page carries no claim: the public Site and listing hold neither a token nor a domain name", async () => {
    const hosts = await asOwner(async (client) => {
      const claimToken = token();
      const host = uniqueHost("leak");
      await insertRow(client, claimRow(apex, site.apexMain, null, { hostname: host, verification_token: claimToken, status: "active", verified_at: new Date(), activated_at: new Date(), is_primary: true }));
      const siteJson = JSON.stringify((await client.query("select app_public_site('apexclimate', '') as site")).rows[0].site);
      const listingJson = JSON.stringify((await client.query("select app_public_listing('apex-climate-heating-air') as listing")).rows[0].listing);
      return { siteJson, listingJson, claimToken, host };
    });
    expect(hosts.value?.siteJson).not.toContain(hosts.value!.claimToken);
    expect(hosts.value?.listingJson).not.toContain(hosts.value!.claimToken);
    expect(hosts.value?.siteJson).not.toContain(hosts.value!.host);
  });
});

test.describe("two requests at once (committing, on the worker's own copy of Apex)", () => {
  test("two Sites claiming one name at the same moment: exactly one gets it", async ({ workerTenant }) => {
    const host = uniqueHost("race");
    const sites = (await admin.query<{ id: string }>("select id from sites where organization_id = $1 and slug in ('main', 'commercial') order by slug", [workerTenant.organizationId])).rows.map((row) => row.id);
    expect(sites).toHaveLength(2);
    const claim = async (siteId: string) => {
      const client = await app.connect();
      try {
        await client.query("begin");
        await context(client, workerTenant.userId, workerTenant.organizationId);
        await insertRow(client, claimRow(workerTenant.organizationId, siteId, workerTenant.userId, { hostname: host }));
        // Hold the transaction open for a moment so the two inserts overlap.
        await new Promise((resolve) => setTimeout(resolve, 150));
        await client.query("commit");
        return "claimed";
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return (error as { constraint?: string }).constraint ?? "other";
      } finally {
        client.release();
      }
    };
    const outcomes = await Promise.all(sites.map(claim));
    expect(outcomes.filter((outcome) => outcome === "claimed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "site_domains_hostname_unique")).toHaveLength(1);
    expect((await admin.query("select count(*)::int as n from site_domains where hostname = $1", [host])).rows[0].n).toBe(1);
  });

  test("two domains of one Site made main at the same moment: exactly one is, whatever the order", async ({ workerTenant }) => {
    const mainSite = await idOf("select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId]);
    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const row = await admin.query<{ id: string }>(
        "insert into site_domains (organization_id, site_id, hostname, status, verification_token, verified_at, activated_at) values ($1, $2, $3, 'active', $4, now(), now()) returning id",
        [workerTenant.organizationId, mainSite, uniqueHost("both"), token()],
      );
      ids.push(row.rows[0].id);
    }
    const makeMain = async (id: string) => {
      const client = await app.connect();
      try {
        await client.query("begin");
        await context(client, workerTenant.userId, workerTenant.organizationId);
        await client.query("update site_domains set is_primary = true where id = $1", [id]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await client.query("commit");
        return "main";
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return (error as { constraint?: string }).constraint ?? "other";
      } finally {
        client.release();
      }
    };
    const outcomes = await Promise.all(ids.map(makeMain));
    expect(outcomes.filter((outcome) => outcome === "main")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "site_domains_primary_unique")).toHaveLength(1);
    expect((await admin.query("select count(*)::int as n from site_domains where site_id = $1 and is_primary", [mainSite])).rows[0].n).toBe(1);
  });
});
