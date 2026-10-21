/**
 * Tenant isolation of the CORE business data (customers, properties, equipment, Services, the team), at the DATABASE.
 *
 * Like database-isolation.spec.ts, these connect as the restricted runtime role (`climvia_app`, DATABASE_URL), set the
 * transaction-local context the way src/db/tenant.ts does, and ask PostgreSQL itself: Row Level Security, the column and
 * table grants, the composite foreign keys and the triggers have to keep businesses apart whatever the application code
 * does. Every test runs in a transaction that is rolled back, so nothing here changes the data other specs use.
 *
 *   Alex    Apex owner      Jamie   Apex member (read only)
 *   Taylor  Northstar owner Casey   admin in both
 */
import { test, expect } from "playwright/test";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const SEED = {
  alex: "alex.morgan@apex.test",
  jamie: "jamie.rivera@apex.test",
  taylor: "taylor.brooks@northstar.test",
  casey: "casey.nguyen@climvia.test",
};

/** Every table that holds core business data. Each carries `organization_id` itself, not through a parent. */
const CORE_TABLES = [
  "customers",
  "customer_notes",
  "customer_properties",
  "equipment",
  "services",
  "team_roles",
  "team_members",
  "team_member_services",
  "team_member_availability",
  "team_member_unavailable_periods",
  "team_activity",
] as const;
const READ_ONLY_TABLES = ["customers", "customer_notes", "customer_properties", "equipment"] as const;

let app: Pool;
let admin: Pool;
const ids: Record<string, string> = {};
let apex = "";
let northstar = "";
/** A row of Northstar's, found as the owner, so the runtime role can be made to reach for it by id. */
const foreign = { service: "", role: "", member: "" };

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  for (const [key, email] of Object.entries(SEED)) {
    ids[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  }
  apex = (await admin.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
  northstar = (await admin.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
  const first = async (table: string) => (await admin.query<{ id: string }>(`select id from ${table} where organization_id = $1 order by created_at, id limit 1`, [northstar])).rows[0].id;
  foreign.service = await first("services");
  foreign.role = await first("team_roles");
  foreign.member = await first("team_members");
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined } | { value?: undefined; error: string; code: string };

/** Run `fn` through `pool` inside a transaction that is always rolled back; the context is set the way src/db/tenant.ts does. */
async function within<T>(pool: Pool, user: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (pool === app) await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [user ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    const failure = error as { message?: string; code?: string };
    return { error: failure.message ?? String(error), code: failure.code ?? "" };
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
const as = <T>(user: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>) => within(app, user, org, fn);
const asOwner = <T>(fn: (client: PoolClient) => Promise<T>) => within(admin, null, null, fn);

const count = async (client: PoolClient, table: string, where = "true") =>
  (await client.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n;
const countsOf = async (client: PoolClient) => Object.fromEntries(await Promise.all(CORE_TABLES.map(async (table) => [table, await count(client, table)])));
const one = async <T extends QueryResultRow>(client: PoolClient, sql: string, params: unknown[] = []) => (await client.query<T>(sql, params)).rows[0];

/** The org's own row counts, read as the owner (who is not subject to the tenant context). */
async function stored(org: string) {
  const entries = await Promise.all(CORE_TABLES.map(async (table) => [table, (await admin.query<{ n: number }>(`select count(*)::int as n from ${table} where organization_id = $1`, [org])).rows[0].n]));
  return Object.fromEntries(entries) as Record<(typeof CORE_TABLES)[number], number>;
}

test.describe("the schema", () => {
  test("every core table carries organization_id itself, NOT NULL, and has Row Level Security enabled", async () => {
    const columns = await admin.query<{ table_name: string; is_nullable: string }>(
      "select table_name, is_nullable from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and table_name = any($1)",
      [CORE_TABLES],
    );
    expect(columns.rows.map((row) => row.table_name).sort()).toEqual([...CORE_TABLES].sort());
    expect(columns.rows.every((row) => row.is_nullable === "NO")).toBe(true);
    const rls = await admin.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname = any($1) and relkind = 'r'", [CORE_TABLES]);
    expect(rls.rows).toHaveLength(CORE_TABLES.length);
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  test("every core table has a SELECT policy for the runtime role, and no policy for any other role", async () => {
    const { rows } = await admin.query<{ tablename: string; cmd: string; roles: string[] }>("select tablename, cmd, roles::text[] as roles from pg_policies where tablename = any($1)", [CORE_TABLES]);
    for (const table of CORE_TABLES) {
      expect(rows.some((row) => row.tablename === table && row.cmd === "SELECT"), `${table} has a SELECT policy`).toBe(true);
    }
    expect(rows.every((row) => row.roles.length === 1 && row.roles[0] === "climvia_app")).toBe(true);
  });

  test("the lists the product asks for are indexed by organization", async () => {
    const { rows } = await admin.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'public' and tablename = any($1)", [CORE_TABLES]);
    const names = rows.map((row) => row.indexname);
    for (const expected of [
      "customers_org_name_idx", // customer lists
      "customer_properties_customer_idx", // customer_id
      "equipment_property_idx", // property_id
      "services_org_active_idx", // service status
      "services_org_order_idx",
      "team_members_org_status_idx", // team status
      "team_members_role_idx", // role relation
      "team_member_services_service_idx", // service relation
    ]) {
      expect(names, expected).toContain(expected);
    }
  });
});

test.describe("reading", () => {
  test("with no context nothing is visible, in any core table", async () => {
    const result = await as(null, null, countsOf);
    expect(Object.values(result.value ?? {}).every((n) => n === 0)).toBe(true);
    expect(Object.keys(result.value ?? {}).sort()).toEqual([...CORE_TABLES].sort());
  });

  test("a user in Apex only sees Apex's rows, table by table, and none of Northstar's", async () => {
    const expected = await stored(apex);
    expect(expected.customers).toBeGreaterThan(0);
    expect(expected.services).toBe(6);
    const result = await as(ids.alex, apex, countsOf);
    expect(result.value).toEqual(expected);
    const foreign = await as(ids.alex, apex, async (client) => count(client, "services", `organization_id = '${northstar}'`));
    expect(foreign.value).toBe(0);
  });

  test("a user in Northstar only sees Northstar's rows", async () => {
    const result = await as(ids.taylor, northstar, countsOf);
    expect(result.value).toEqual(await stored(northstar));
    expect(result.value).toMatchObject({ customers: 2, customer_properties: 2, equipment: 1, services: 3, team_members: 2 });
  });

  test("pointing the context at an organization you are not in returns none of its core rows", async () => {
    const alexAtNorthstar = await as(ids.alex, northstar, countsOf);
    expect(Object.values(alexAtNorthstar.value ?? {}).every((n) => n === 0)).toBe(true);
    const taylorAtApex = await as(ids.taylor, apex, countsOf);
    expect(Object.values(taylorAtApex.value ?? {}).every((n) => n === 0)).toBe(true);
  });

  test("a user in both sees only the ACTIVE organization's rows, never both at once", async () => {
    const atApex = await as(ids.casey, apex, countsOf);
    const atNorthstar = await as(ids.casey, northstar, countsOf);
    expect(atApex.value).toEqual(await stored(apex));
    expect(atNorthstar.value).toEqual(await stored(northstar));
  });

  test("the same public reference in two businesses is two unrelated rows, and each only reads its own", async () => {
    // Both businesses have a Service with the slug "ac-repair-diagnostics", with different names.
    const apexSide = await as(ids.alex, apex, (client) => one<{ name: string }>(client, "select name from services where slug = 'ac-repair-diagnostics'"));
    const northstarSide = await as(ids.taylor, northstar, (client) => one<{ name: string }>(client, "select name from services where slug = 'ac-repair-diagnostics'"));
    expect(apexSide.value?.name).toBe("AC Repair & Diagnostics");
    expect(northstarSide.value?.name).toBe("Cooling Diagnostic Visit");
  });
});

test.describe("writing: customers may be added and nothing else about customers, properties or equipment is writable by the runtime role", () => {
  for (const table of READ_ONLY_TABLES) {
    test(`${table}: ${table === "customers" ? "an owner may ADD one (drizzle/0030), and is still refused UPDATE and DELETE" : "even an owner is refused INSERT, UPDATE and DELETE"}`, async () => {
      const insert =
        table === "customers"
          ? "insert into customers (organization_id, slug, name, phone, email) values ($1, 'zz-new', 'Zed', '1', 'z@example.test')"
          : table === "customer_notes"
            ? "insert into customer_notes (organization_id, customer_id, body, recorded_by, updated_on) select organization_id, id, 'x', 'x', '2024-01-01' from customers where organization_id = $1 limit 1"
            : table === "customer_properties"
              ? "insert into customer_properties (organization_id, customer_id, slug, label, address_line1, city, state_region, postal_code) select organization_id, id, 'zz', 'Home', '1 A St', 'X', 'TX', '78701' from customers where organization_id = $1 limit 1"
              : "insert into equipment (organization_id, property_id, slug, name, kind, manufacturer, model, model_code, serial_number, location, in_service_since) select organization_id, id, 'zz', 'x', 'x', 'x', 'x', 'x', 'x', 'x', '2020-01' from customer_properties where organization_id = $1 limit 1";
      const inserted = await as(ids.alex, apex, (client) => client.query(insert, [apex]));
      // Adding a customer is the one write the Customers module has (the owner/admin policy of 0030; customer-acquisition-database.spec.ts holds who may). It is rolled back here.
      if (table === "customers") expect(inserted.error, "insert into customers").toBeUndefined();
      else expect(inserted.error, `insert into ${table}`).toMatch(/permission denied/);
      const touch = table === "customer_notes" ? "body = body" : "updated_at = now()";
      const updated = await as(ids.alex, apex, (client) => client.query(`update ${table} set ${touch} where organization_id = $1`, [apex]));
      expect(updated.error, `update ${table}`).toMatch(/permission denied/);
      const deleted = await as(ids.alex, apex, (client) => client.query(`delete from ${table} where organization_id = $1`, [apex]));
      expect(deleted.error, `delete from ${table}`).toMatch(/permission denied/);
    });
  }
});

test.describe("writing: Services and the team are for owners and admins of the ACTIVE organization", () => {
  const newService = (org: string, slug = "zz-test-service") =>
    `insert into services (organization_id, slug, name, category, description, duration_minutes, pricing_model, booking_method, display_order) values ('${org}', '${slug}', 'Zed', 'Cooling', 'x', 60, 'free-assessment', 'instant', 99)`;

  test("an owner can add and change a Service of their own business", async () => {
    const result = await as(ids.alex, apex, async (client) => {
      await client.query(newService(apex));
      const changed = await client.query("update services set name = 'Renamed' where slug = 'zz-test-service' and organization_id = $1", [apex]);
      return changed.rowCount;
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(1);
  });

  test("an admin of two businesses can write to the one that is active, and only that one", async () => {
    const inActive = await as(ids.casey, northstar, (client) => client.query(newService(northstar)));
    expect(inActive.error).toBeUndefined();
    const inOther = await as(ids.casey, northstar, (client) => client.query(newService(apex)));
    expect(inOther.error).toMatch(/row-level security/);
  });

  test("a member can read but cannot add or change a Service, a role or a team member", async () => {
    const insertService = await as(ids.jamie, apex, (client) => client.query(newService(apex)));
    expect(insertService.error).toMatch(/row-level security/);
    const updateService = await as(ids.jamie, apex, (client) => client.query("update services set name = 'Hijacked' where organization_id = $1", [apex]));
    expect(updateService.error).toBeUndefined();
    expect(updateService.value?.rowCount).toBe(0);
    const updateMember = await as(ids.jamie, apex, (client) => client.query("update team_members set status = 'inactive' where organization_id = $1", [apex]));
    expect(updateMember.value?.rowCount).toBe(0);
    const updateRole = await as(ids.jamie, apex, (client) => client.query("update team_roles set description = 'x' where organization_id = $1", [apex]));
    expect(updateRole.value?.rowCount).toBe(0);
    const insertRole = await as(ids.jamie, apex, (client) =>
      client.query("insert into team_roles (organization_id, slug, name, kind, permissions) values ($1, 'zz', 'Zed', 'custom', '{}')", [apex]),
    );
    expect(insertRole.error).toMatch(/row-level security/);
    const readable = await as(ids.jamie, apex, (client) => count(client, "services"));
    expect(readable.value).toBe(6);
  });

  test("a member cannot add or change the team's assignments, availability, history or people", async () => {
    const insertMember = await as(ids.jamie, apex, (client) =>
      client.query("insert into team_members (organization_id, slug, name, job_title) values ($1, 'zz-member', 'Zed', 'Technician')", [apex]),
    );
    expect(insertMember.error).toMatch(/row-level security/);
    const assign = await as(ids.jamie, apex, (client) =>
      client.query(
        `insert into team_member_services (organization_id, member_id, service_id)
         select m.organization_id, m.id, s.id from team_members m, services s
         where m.organization_id = $1 and m.slug = 'alex-morgan' and s.organization_id = $1 and s.slug = 'ac-repair-diagnostics'
         on conflict do nothing`,
        [apex],
      ),
    );
    expect(assign.error).toMatch(/row-level security/);
    const log = await as(ids.jamie, apex, (client) =>
      client.query(
        `insert into team_activity (organization_id, member_id, ref, occurred_at, category, title)
         select organization_id, id, 'zz', '2024-01-01T00:00', 'access', 'x' from team_members where organization_id = $1 limit 1`,
        [apex],
      ),
    );
    expect(log.error).toMatch(/row-level security/);
    // Updates and deletes find no row they may touch, and nothing is changed.
    const removeAssignments = await as(ids.jamie, apex, (client) => client.query("delete from team_member_services where organization_id = $1", [apex]));
    expect(removeAssignments.value?.rowCount).toBe(0);
    const changeHours = await as(ids.jamie, apex, (client) => client.query("update team_member_availability set enabled = not enabled where organization_id = $1", [apex]));
    expect(changeHours.value?.rowCount).toBe(0);
    const dropPeriods = await as(ids.jamie, apex, (client) => client.query("delete from team_member_unavailable_periods where organization_id = $1", [apex]));
    expect(dropPeriods.value?.rowCount).toBe(0);
    const stillThere = await asOwner((client) => count(client, "team_member_services", `organization_id = '${apex}'`));
    expect(stillThere.value).toBeGreaterThan(0);
  });

  test("an owner cannot write into another business, however the row is addressed", async () => {
    const insert = await as(ids.alex, apex, (client) => client.query(newService(northstar)));
    expect(insert.error).toMatch(/row-level security/);
    const update = await as(ids.alex, apex, (client) => client.query("update services set name = 'Hijacked' where organization_id = $1", [northstar]));
    expect(update.value?.rowCount).toBe(0);
    const member = await as(ids.alex, apex, (client) => client.query("update team_members set status = 'inactive' where organization_id = $1", [northstar]));
    expect(member.value?.rowCount).toBe(0);
    // And the other business's rows are exactly as they were.
    expect((await admin.query("select count(*)::int as n from services where organization_id = $1 and name = 'Hijacked'", [northstar])).rows[0].n).toBe(0);
  });

  test("a row cannot be moved to another business, and keys cannot be rewritten", async () => {
    const move = await as(ids.alex, apex, (client) => client.query("update services set organization_id = $1 where organization_id = $2", [northstar, apex]));
    expect(move.error).toMatch(/permission denied/);
    const rekey = await as(ids.alex, apex, (client) => client.query("update services set id = gen_random_uuid() where organization_id = $1", [apex]));
    expect(rekey.error).toMatch(/permission denied/);
    const relink = await as(ids.alex, apex, (client) => client.query("update team_members set user_id = $1 where organization_id = $2", [ids.jamie, apex]));
    expect(relink.error).toMatch(/permission denied/);
  });

  test("nothing in this domain can be deleted through the runtime role (history is deactivated, not erased)", async () => {
    for (const table of ["services", "team_roles", "team_members", "team_activity"]) {
      const result = await as(ids.alex, apex, (client) => client.query(`delete from ${table} where organization_id = $1`, [apex]));
      expect(result.error, table).toMatch(/permission denied/);
    }
  });

  test("the Owner role cannot be renamed or have its permissions changed, even by an owner", async () => {
    const rename = await as(ids.alex, apex, (client) => client.query("update team_roles set name = 'Boss' where organization_id = $1 and slug = 'owner'", [apex]));
    expect(rename.error).toMatch(/protected role cannot be changed/);
    const permissions = await as(ids.alex, apex, (client) => client.query("update team_roles set permissions = '{}' where organization_id = $1 and slug = 'owner'", [apex]));
    expect(permissions.error).toMatch(/protected role cannot be changed/);
  });
});

test.describe("references across businesses are impossible", () => {
  test("a property cannot belong to another business's customer", async () => {
    const result = await asOwner((client) =>
      client.query(
        `insert into customer_properties (organization_id, customer_id, slug, label, address_line1, city, state_region, postal_code)
         select $1, id, 'zz-stray', 'Home', '1 A St', 'Austin', 'TX', '78701' from customers where organization_id = $2 limit 1`,
        [apex, northstar],
      ),
    );
    expect(result.code).toBe("23503");
    expect(result.error).toMatch(/customer_properties_customer_fk/);
  });

  test("equipment cannot be installed at another business's property", async () => {
    const result = await asOwner((client) =>
      client.query(
        `insert into equipment (organization_id, property_id, slug, name, kind, manufacturer, model, model_code, serial_number, location, in_service_since)
         select $1, id, 'zz-stray', 'x', 'x', 'x', 'x', 'x', 'x', 'x', '2020-01' from customer_properties where organization_id = $2 limit 1`,
        [apex, northstar],
      ),
    );
    expect(result.code).toBe("23503");
    expect(result.error).toMatch(/equipment_property_fk/);
  });

  test("a team member cannot be assigned another business's Service, even by an owner through the runtime role", async () => {
    const result = await as(ids.alex, apex, (client) =>
      client.query(
        `insert into team_member_services (organization_id, member_id, service_id)
         values ($1, (select id from team_members where organization_id = $1 limit 1), $2)`,
        [apex, foreign.service],
      ),
    );
    expect(result.code).toBe("23503");
    expect(result.error).toMatch(/team_member_services_service_fk/);
  });

  test("a team member cannot be given another business's role", async () => {
    const result = await as(ids.alex, apex, (client) =>
      client.query("insert into team_members (organization_id, slug, name, job_title, role_id) values ($1, 'zz-stray', 'Stray', 'Technician', $2)", [apex, foreign.role]),
    );
    expect(result.code).toBe("23503");
    expect(result.error).toMatch(/team_members_role_fk/);
  });

  test("a team member's availability, activity and author must belong to the same business too", async () => {
    // A day row stamped with one business but pointing at another business's member (a member with no rows yet, so the
    // primary key is not what refuses it).
    const availability = await asOwner(async (client) => {
      const bare = await client.query<{ id: string }>("insert into team_members (organization_id, slug, name, job_title) values ($1, 'zz-bare', 'Bare', 'Technician') returning id", [apex]);
      await client.query("insert into team_member_availability (organization_id, member_id, day_of_week, enabled, start_time, end_time) values ($1, $2, 0, false, '09:00', '17:00')", [northstar, bare.rows[0].id]);
    });
    expect(availability.code).toBe("23503");
    expect(availability.error).toMatch(/team_member_availability_member_fk/);
    const author = await as(ids.alex, apex, (client) =>
      client.query(
        `insert into team_activity (organization_id, member_id, ref, occurred_at, category, title, by_member_id)
         values ($1, (select id from team_members where organization_id = $1 limit 1), 'zz', '2024-01-01T00:00', 'access', 'x', $2)`,
        [apex, foreign.member],
      ),
    );
    expect(author.code).toBe("23503");
  });

  test("a team member's Climvia login must be an active member of the same business", async () => {
    // Taylor belongs to Northstar only, so cannot be linked to an Apex team member.
    const insert = await asOwner((client) =>
      client.query("insert into team_members (organization_id, slug, name, job_title, user_id) values ($1, 'zz-linked', 'Linked', 'Tech', $2)", [apex, ids.taylor]),
    );
    expect(insert.code).toBe("23514");
    expect(insert.error).toMatch(/same organization/);
    const update = await asOwner((client) => client.query("update team_members set user_id = $1 where organization_id = $2 and slug = 'marcus-vance'", [ids.taylor, apex]));
    expect(update.code).toBe("23514");
    // A login that does belong is accepted, and not every team member needs one.
    const fine = await asOwner((client) => client.query("update team_members set user_id = $1 where organization_id = $2 and slug = 'marcus-vance'", [ids.jamie, apex]));
    expect(fine.error).toBeUndefined();
    const withoutLogin = await admin.query<{ n: number }>("select count(*)::int as n from team_members where organization_id = $1 and user_id is null", [apex]);
    expect(withoutLogin.rows[0].n).toBeGreaterThan(0);
  });

  test("a login is linked to at most one team member per business", async () => {
    const result = await asOwner(async (client) => {
      await client.query("update team_members set user_id = $1 where organization_id = $2 and slug = 'marcus-vance'", [ids.jamie, apex]);
      await client.query("update team_members set user_id = $1 where organization_id = $2 and slug = 'samira-patel'", [ids.jamie, apex]);
    });
    expect(result.code).toBe("23505");
  });
});

test.describe("integrity within a business", () => {
  test("a Service's name and slug are unique per business, and can repeat across businesses", async () => {
    const duplicateName = await asOwner((client) =>
      client.query(
        `insert into services (organization_id, slug, name, category, description, duration_minutes, pricing_model, booking_method, display_order)
         values ($1, 'zz-copy', 'ac repair & diagnostics', 'Cooling', 'x', 60, 'free-assessment', 'instant', 99)`,
        [apex],
      ),
    );
    expect(duplicateName.code).toBe("23505");
    const sameSlugElsewhere = await asOwner((client) =>
      client.query(
        `insert into services (organization_id, slug, name, category, description, duration_minutes, pricing_model, booking_method, display_order)
         values ($1, 'radiant-heat-estimate', 'A Different Name', 'Heating', 'x', 60, 'free-assessment', 'instant', 99)`,
        [apex],
      ),
    );
    expect(sameSlugElsewhere.error).toBeUndefined();
  });

  test("Service rules the database keeps itself: price shape, duration, category and intake", async () => {
    const insert = (values: string) =>
      asOwner((client) =>
        client.query(`insert into services (organization_id, slug, name, category, description, duration_minutes, pricing_model, price_amount, price_label, booking_method, display_order, intake)
          values ($1, 'zz-rule', 'Rule Test', ${values})`, [apex]),
      );
    expect((await insert("'Cooling', 'x', 60, 'fixed-price', null, null, 'instant', 99, '[]'")).code, "a fixed price needs an amount").toBe("23514");
    expect((await insert("'Cooling', 'x', 5, 'free-assessment', null, null, 'instant', 99, '[]'")).code, "duration under 15 minutes").toBe("23514");
    expect((await insert("'Plumbing', 'x', 60, 'free-assessment', null, null, 'instant', 99, '[]'")).code, "unknown category").toBe("23514");
    expect((await insert("'Cooling', 'x', 60, 'free-assessment', null, null, 'instant', 99, '{}'")).code, "intake must be an array").toBe("23514");
    expect((await insert("'Cooling', 'x', 60, 'free-assessment', null, null, 'instant', 99, '[]'")).error).toBeUndefined();
  });

  test("a customer has at most one primary property", async () => {
    const result = await asOwner(async (client) => {
      const customer = await one<{ organization_id: string; id: string }>(client, "select organization_id, id from customers where organization_id = $1 and slug = 'sarah-mitchell'", [apex]);
      const insert = (slug: string) =>
        client.query(
          `insert into customer_properties (organization_id, customer_id, slug, label, address_line1, city, state_region, postal_code, is_primary)
           values ($1, $2, $3, 'Home', '1 A St', 'Austin', 'TX', '78701', true)`,
          [customer.organization_id, customer.id, slug],
        );
      await insert("zz-primary-1");
    });
    // Sarah already has a primary property, so a second primary is refused.
    expect(result.code).toBe("23505");
  });
});
