/**
 * Tenant isolation at the DATABASE, independent of the application code.
 *
 * These connect to the freshly migrated and seeded test database as the same restricted runtime role the app uses
 * (`climvia_app`, DATABASE_URL), set the transaction-local context the way src/db/tenant.ts does, and check that
 * PostgreSQL itself, through Row Level Security and the column / function grants, keeps businesses apart. Every test runs
 * in a transaction that is rolled back, so nothing here changes the data other specs use.
 */
import { test as base, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";

const test = base;

const SEED = {
  alex: "alex.morgan@apex.test", // Apex owner
  jamie: "jamie.rivera@apex.test", // Apex member
  taylor: "taylor.brooks@northstar.test", // Northstar owner
  casey: "casey.nguyen@climvia.test", // admin in both
};

let app: Pool;
let admin: Pool;
const ids: Record<string, string> = {};
let apex = "";
let northstar = "";

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  for (const [key, email] of Object.entries(SEED)) {
    ids[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  }
  apex = (await admin.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
  northstar = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

/** Run `fn` as `user` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(user: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [user ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n;
const slugs = async (client: PoolClient) => (await client.query<{ slug: string }>("select slug from organizations order by slug")).rows.map((row) => row.slug);

test.describe("the runtime role", () => {
  test("is not a superuser, does not bypass Row Level Security, and owns nothing", async () => {
    const { rows } = await admin.query("select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'climvia_app'");
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    const owned = await admin.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and pg_get_userbyid(c.relowner) = 'climvia_app'");
    expect(owned.rows[0].n).toBe(0);
  });

  test("every tenant table has Row Level Security enabled; only the identity tables do not, and they hold no tenant data", async () => {
    const { rows } = await admin.query<{ relname: string }>(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    // Better Auth must read these before anyone is signed in, so they are reached only through Better Auth and carry no organization_id.
    expect(rows.map((row) => row.relname).sort()).toEqual(["auth_account", "auth_session", "auth_user", "auth_verification"]);
    const tenantColumns = await admin.query("select table_name from information_schema.columns where table_schema = 'public' and table_name like 'auth\_%' and column_name = 'organization_id'");
    expect(tenantColumns.rows).toEqual([]);
  });

  test("the application's own connection is the restricted role", async () => {
    const result = await as(null, null, async (client) => (await client.query("select current_user as u")).rows[0].u);
    expect(result.value).toBe("climvia_app");
  });
});

test.describe("reading", () => {
  test("with no context nothing is visible, in any tenant table", async () => {
    const result = await as(null, null, async (client) => ({
      organizations: await count(client, "organizations"),
      memberships: await count(client, "organization_memberships"),
      hours: await count(client, "organization_business_hours"),
      sites: await count(client, "sites"),
      profiles: await count(client, "profiles"),
    }));
    expect(result.value).toEqual({ organizations: 0, memberships: 0, hours: 0, sites: 0, profiles: 0 });
  });

  test("a user who is only in Apex sees only Apex's data", async () => {
    const result = await as(ids.alex, apex, async (client) => ({
      organizations: await slugs(client),
      hours: await count(client, "organization_business_hours"),
      sites: await count(client, "sites"),
      profiles: await count(client, "profiles"),
    }));
    expect(result.value).toEqual({ organizations: ["apex-climate-heating-air"], hours: 7, sites: 2, profiles: 1 });
  });

  test("a user who is only in Northstar sees only Northstar's data", async () => {
    const result = await as(ids.taylor, northstar, async (client) => ({
      organizations: await slugs(client),
      hours: await count(client, "organization_business_hours"),
      sites: await count(client, "sites"),
    }));
    expect(result.value).toEqual({ organizations: ["northstar-heating-cooling"], hours: 7, sites: 1 });
  });

  test("pointing the context at an organization you are not in returns none of its rows", async () => {
    const alexAtNorthstar = await as(ids.alex, northstar, async (client) => ({
      hours: await count(client, "organization_business_hours"),
      sites: await count(client, "sites"),
      organizations: await slugs(client),
    }));
    expect(alexAtNorthstar.value).toEqual({ hours: 0, sites: 0, organizations: ["apex-climate-heating-air"] });
    const taylorAtApex = await as(ids.taylor, apex, async (client) => ({ hours: await count(client, "organization_business_hours"), sites: await count(client, "sites") }));
    expect(taylorAtApex.value).toEqual({ hours: 0, sites: 0 });
  });

  test("a user in two organizations sees both, and the hours of whichever is active", async () => {
    const atApex = await as(ids.casey, apex, async (client) => ({ organizations: await slugs(client), hours: await count(client, "organization_business_hours") }));
    const atNorthstar = await as(ids.casey, northstar, async (client) => ({ organizations: await slugs(client), hours: await count(client, "organization_business_hours") }));
    expect(atApex.value).toEqual({ organizations: ["apex-climate-heating-air", "northstar-heating-cooling"], hours: 7 });
    expect(atNorthstar.value).toEqual({ organizations: ["apex-climate-heating-air", "northstar-heating-cooling"], hours: 7 });
  });

  test("a person cannot read another person's profile", async () => {
    const result = await as(ids.alex, apex, async (client) => (await client.query("select count(*)::int as n from profiles where user_id = $1", [ids.jamie])).rows[0].n);
    expect(result.value).toBe(0);
  });

  test("co-members see each other's memberships, and no one else's", async () => {
    const alex = await as(ids.alex, apex, async (client) => (await client.query<{ organization_id: string }>("select distinct organization_id from organization_memberships")).rows.map((row) => row.organization_id));
    expect(alex.value).toEqual([apex]);
  });
});

test.describe("writing", () => {
  test("an owner of Apex cannot change Northstar", async () => {
    const result = await as(ids.alex, northstar, async (client) => (await client.query("update organizations set name = 'Hijacked' where id = $1", [northstar])).rowCount);
    expect(result.value).toBe(0);
  });

  test("an owner of Apex can change Apex; a member of Apex cannot", async () => {
    const owner = await as(ids.alex, apex, async (client) => (await client.query("update organizations set name = name where id = $1", [apex])).rowCount);
    const member = await as(ids.jamie, apex, async (client) => (await client.query("update organizations set name = 'Nope' where id = $1", [apex])).rowCount);
    expect(owner.value).toBe(1);
    expect(member.value).toBe(0);
  });

  test("a user cannot add hours to another organization", async () => {
    const result = await as(ids.alex, northstar, (client) => client.query("insert into organization_business_hours (organization_id, day_of_week, is_open) values ($1, 3, false)", [northstar]));
    expect(result.error).toBeTruthy();
  });

  test("an owner can change their own hours; a member cannot", async () => {
    const sql = "update organization_business_hours set is_open = false, opens_at = null, closes_at = null where organization_id = $1 and day_of_week = 0";
    const owner = await as(ids.alex, apex, async (client) => (await client.query(sql, [apex])).rowCount);
    const member = await as(ids.jamie, apex, async (client) => (await client.query(sql, [apex])).rowCount);
    expect(owner.value).toBe(1);
    expect(member.value).toBe(0);
  });

  test("a user cannot add a site to another organization", async () => {
    const result = await as(ids.alex, northstar, (client) => client.query("insert into sites (organization_id, name, slug) values ($1, 'Intruder', 'intruder')", [northstar]));
    expect(result.error).toBeTruthy();
  });

  test("a user cannot make themselves a member or owner of someone else's organization", async () => {
    const result = await as(ids.alex, apex, (client) => client.query("insert into organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')", [northstar, ids.alex]));
    expect(result.error).toBeTruthy();
  });

  test("a user cannot change another person's profile", async () => {
    const result = await as(ids.alex, apex, async (client) => (await client.query("update profiles set full_name = 'Renamed' where user_id = $1", [ids.jamie])).rowCount);
    expect(result.value).toBe(0);
  });

  test("a signed-in user can create an organization row; nobody without a user can", async () => {
    const signedIn = await as(ids.alex, null, (client) => client.query("insert into organizations (name, slug, timezone) values ('Mine', 'mine-x', 'America/Chicago')"));
    const anonymous = await as(null, null, (client) => client.query("insert into organizations (name, slug, timezone) values ('Anon', 'anon-x', 'America/Chicago')"));
    expect(signedIn.error).toBeUndefined();
    expect(anonymous.error).toBeTruthy();
  });
});

test.describe("creating a workspace", () => {
  const ORGANIZATION_COLUMNS = `id, name, slug, phone, email, address_line1, address_line2, city, state_region, postal_code, country,
    timezone, currency, date_format, time_format, fixture_set, onboarding_completed_at, created_at, updated_at`;
  const ORGANIZATION_VALUES = `$1, 'Shape Test Heating', 'shape-test-heating', '(303) 555-0100', 'a@b.test', '1 Main St', null, 'Denver', 'CO', '80203', 'US',
    'America/Denver', 'USD', 'mdy-short', '12h', default, now(), default, default`;
  const newId = () => crypto.randomUUID();

  test("accepts the exact statement the application sends: every column named, the unset ones as DEFAULT", async () => {
    const id = newId();
    const result = await as(ids.alex, null, (client) => client.query(`insert into organizations (${ORGANIZATION_COLUMNS}) values (${ORGANIZATION_VALUES})`, [id]));
    expect(result.error).toBeUndefined();
  });

  test("refuses a new organization that carries the sample-data flag", async () => {
    const result = await as(ids.alex, null, (client) =>
      client.query(`insert into organizations (id, name, slug, timezone, fixture_set) values ($1, 'Flagged', 'flagged-x', 'America/Chicago', 'apex-demo')`, [newId()]),
    );
    expect(result.error).toMatch(/row-level security/i);
  });

  test("makes the creator the owner only while the organization has no members, and nobody else can join it that way", async () => {
    const outcome = await as(ids.alex, null, async (client) => {
      const id = newId();
      await client.query(`insert into organizations (id, name, slug, timezone) values ($1, 'Mine', 'mine-y', 'America/Chicago')`, [id]);
      await client.query(`insert into organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')`, [id, ids.alex]);
      let second = "accepted";
      try {
        await client.query("savepoint s");
        await client.query(`insert into organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')`, [id, ids.taylor]);
      } catch (error) {
        second = (error as Error).message;
        await client.query("rollback to savepoint s");
      }
      return second;
    });
    expect(outcome.value).toMatch(/row-level security/i);
  });

  test("is all or nothing: if a later step fails, no organization, membership, hours or site is left behind", async () => {
    const id = newId();
    const client = await app.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', '', true)", [ids.alex]);
      await client.query(`insert into organizations (id, name, slug, timezone) values ($1, 'Half Made', 'half-made', 'America/Chicago')`, [id]);
      await client.query(`insert into organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'owner', 'active')`, [id, ids.alex]);
      await client.query("select set_config('app.org_id', $1, true)", [id]);
      // Closing before opening breaks a rule of the hours table, partway through.
      await expect(client.query(`insert into organization_business_hours (organization_id, day_of_week, is_open, opens_at, closes_at) values ($1, 1, true, '17:00', '08:00')`, [id])).rejects.toThrow(/organization_business_hours_times/);
      await client.query("rollback");
    } finally {
      client.release();
    }
    for (const table of ["organizations", "organization_memberships", "organization_business_hours", "sites"]) {
      const column = table === "organizations" ? "id" : "organization_id";
      expect((await admin.query(`select 1 from ${table} where ${column} = $1`, [id])).rowCount, table).toBe(0);
    }
  });
});

test.describe("privileges the runtime role does not have", () => {
  test("it cannot set fixture_set, the sample-data switch", async () => {
    const result = await as(ids.alex, apex, (client) => client.query("update organizations set fixture_set = 'apex-demo' where id = $1", [apex]));
    expect(result.error).toMatch(/permission denied/i);
  });

  test("it cannot delete an organization", async () => {
    const result = await as(ids.alex, apex, (client) => client.query("delete from organizations where id = $1", [apex]));
    expect(result.error).toMatch(/permission denied/i);
  });

  test("it cannot update memberships directly", async () => {
    const result = await as(ids.alex, apex, (client) => client.query("update organization_memberships set role = 'owner' where user_id = $1", [ids.jamie]));
    expect(result.error).toMatch(/permission denied/i);
  });

  test("it cannot delete a site (an organization with sites is protected)", async () => {
    const result = await as(ids.alex, apex, (client) => client.query("delete from sites where organization_id = $1", [apex]));
    expect(result.error).toMatch(/permission denied/i);
  });
});

test.describe("membership changes go through the guarded functions", () => {
  test("a member cannot promote themselves", async () => {
    const result = await as(ids.jamie, apex, (client) => client.query("select app_set_member_role($1, $2, 'admin')", [apex, ids.jamie]));
    expect(result.error).toBeTruthy();
  });

  test("an admin cannot change roles; only an owner can", async () => {
    const result = await as(ids.casey, apex, (client) => client.query("select app_set_member_role($1, $2, 'admin')", [apex, ids.jamie]));
    expect(result.error).toBeTruthy();
  });

  test("the last owner cannot be demoted or removed", async () => {
    const demote = await as(ids.alex, apex, (client) => client.query("select app_set_member_role($1, $2, 'member')", [apex, ids.alex]));
    const remove = await as(ids.alex, apex, (client) => client.query("select app_remove_member($1, $2)", [apex, ids.alex]));
    expect(demote.error).toBeTruthy();
    expect(remove.error).toBeTruthy();
  });

  test("an owner can change a member's role", async () => {
    const result = await as(ids.alex, apex, async (client) => (await client.query<{ app_set_member_role: boolean }>("select app_set_member_role($1, $2, 'admin')", [apex, ids.jamie])).rows[0].app_set_member_role);
    expect(result.value).toBe(true);
  });
});

test.describe("the sites table", () => {
  test("one organization owns many sites; slugs are unique inside it but may repeat across organizations", async () => {
    const apexSites = await admin.query("select slug from sites where organization_id = $1 order by slug", [apex]);
    expect(apexSites.rows.map((row) => row.slug)).toEqual(["commercial", "main"]);
    const northstarSites = await admin.query("select slug from sites where organization_id = $1", [northstar]);
    expect(northstarSites.rows.map((row) => row.slug)).toEqual(["main"]);

    const duplicate = await as(ids.alex, apex, (client) => client.query("insert into sites (organization_id, name, slug) values ($1, 'Again', 'main')", [apex]));
    expect(duplicate.error).toMatch(/sites_org_slug_unique|duplicate key/i);
  });

  test("an organization with sites cannot be deleted, even by its owner role in the database", async () => {
    const result = await admin.query("delete from organizations where id = $1", [apex]).then(
      () => "deleted",
      (error: Error) => error.message,
    );
    expect(result).toMatch(/sites_organization_id|violates foreign key/i);
  });

  test("a domain name belongs to one claim at a time across businesses, in one spelling only, and is free again once the claim is removed", async () => {
    const client = await admin.connect();
    // Each attempt is its own savepoint: a failed statement aborts a transaction, and the next attempt needs it alive.
    const attempt = async (sql: string, params: unknown[]) => {
      await client.query("savepoint attempt");
      try {
        await client.query(sql, params);
        return "accepted";
      } catch (error) {
        await client.query("rollback to savepoint attempt");
        return (error as Error).message;
      }
    };
    const claim = (org: string, host: string) =>
      attempt(
        `insert into site_domains (organization_id, site_id, hostname, verification_token)
         select organization_id, id, $2, translate(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', '-_')
           from sites where organization_id = $1 and slug = 'main'`,
        [org, host],
      );
    try {
      await client.query("begin");
      expect(await claim(apex, "shared.example.test")).toBe("accepted");
      // The same name by another business is refused, and so is every other spelling of it: only the normalized form can be stored at all.
      expect(await claim(northstar, "shared.example.test")).toMatch(/site_domains_hostname_unique|duplicate key/i);
      for (const spelling of ["Shared.Example.Test", "shared.example.test.", "sháred.example.test", " shared.example.test", "*.example.test", "127.0.0.1", "localhost", "a.climvia.com", "climvia.com"]) {
        expect(await claim(northstar, spelling), spelling).toMatch(/site_domains_hostname_(shape|reserved)|check constraint/i);
      }
      // Removing the claim frees the name for another business, which gets a token of its own.
      expect(await attempt("update site_domains set status = 'removed', removed_at = now() where hostname = 'shared.example.test' and organization_id = $1", [apex])).toBe("accepted");
      expect(await claim(northstar, "shared.example.test")).toBe("accepted");
      const tokens = await client.query<{ n: number }>("select count(distinct verification_token)::int as n from site_domains where hostname = 'shared.example.test'");
      expect(tokens.rows[0].n).toBe(2);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});

test.describe("data rules", () => {
  test("an organization's hours must be a closing time after an opening time", async () => {
    const result = await admin.query("update organization_business_hours set opens_at = '17:00', closes_at = '08:00' where organization_id = $1 and day_of_week = 1", [apex]).then(
      () => "accepted",
      (error: Error) => error.message,
    );
    expect(result).toMatch(/organization_business_hours_times|check constraint/i);
  });

  test("a time zone is required on every organization", async () => {
    const result = await admin.query("insert into organizations (name, slug, timezone) values ('No zone', 'no-zone', '')").then(
      () => "accepted",
      (error: Error) => error.message,
    );
    expect(result).toMatch(/organizations_timezone_present|check constraint/i);
  });
});
