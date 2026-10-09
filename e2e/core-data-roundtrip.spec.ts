/**
 * The seed and the application's database layer agree: what the seed wrote is what the application reads back, field for
 * field, and the sample records keep the same database identity every time the database is rebuilt.
 *
 * These read through the restricted runtime role under the tenant context (the way a page does), so they also prove that a
 * member can read the whole of their business's core data and nothing else.
 */
import { test, expect } from "playwright/test";
import { Pool } from "pg";
import { loadCustomerBook, loadServices, loadTeamData } from "../src/db/core-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { NORTHSTAR_CUSTOMERS, NORTHSTAR_EQUIPMENT, NORTHSTAR_PROPERTIES, NORTHSTAR_ROLES, NORTHSTAR_SERVICES, NORTHSTAR_TEAM } from "../scripts/db/seed-data/northstar";
import { CUSTOMERS, EQUIPMENT, PROPERTIES, ROLES, SERVICES, TEAM } from "./apex-data";

let admin: Pool;
const ids = { apex: "", northstar: "", alex: "", taylor: "" };

test.beforeAll(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  const one = async (sql: string) => (await admin.query<{ id: string }>(sql)).rows[0].id;
  ids.apex = await one("select id from organizations where slug = 'apex-climate-heating-air'");
  ids.northstar = await one("select id from organizations where slug = 'northstar-heating-cooling'");
  ids.alex = await one("select id from auth_user where email = 'alex.morgan@apex.test'");
  ids.taylor = await one("select id from auth_user where email = 'taylor.brooks@northstar.test'");
});

test.afterAll(async () => {
  await admin.end();
});

test.describe("what was seeded is what is read", () => {
  test("Apex: Services, customers, properties, equipment, roles and team come back exactly as seeded", async () => {
    const { services, book, team } = await withTenant({ userId: ids.alex, organizationId: ids.apex }, async (tx) => ({
      services: await loadServices(tx, ids.apex),
      book: await loadCustomerBook(tx, ids.apex),
      team: await loadTeamData(tx, ids.apex),
    }));
    expect(services).toEqual(SERVICES);
    expect(book.customers).toEqual(CUSTOMERS);
    expect(book.properties).toEqual(PROPERTIES);
    expect(book.equipment).toEqual(EQUIPMENT);
    expect(team.roles).toEqual(ROLES);
    // The seed links Alex's team record to Alex's login; the application's view of a member does not carry the login.
    expect(team.members).toEqual(TEAM);
  });

  test("Northstar: its own, smaller set comes back exactly as seeded", async () => {
    const { services, book, team } = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, async (tx) => ({
      services: await loadServices(tx, ids.northstar),
      book: await loadCustomerBook(tx, ids.northstar),
      team: await loadTeamData(tx, ids.northstar),
    }));
    expect(services).toEqual(NORTHSTAR_SERVICES);
    expect(book.customers).toEqual(NORTHSTAR_CUSTOMERS);
    expect(book.properties).toEqual(NORTHSTAR_PROPERTIES);
    expect(book.equipment).toEqual(NORTHSTAR_EQUIPMENT);
    expect(team.roles).toEqual(NORTHSTAR_ROLES);
    expect(team.members).toEqual(NORTHSTAR_TEAM);
  });

  test("the same person asking under the other business's context reads nothing of it", async () => {
    const result = await withTenant({ userId: ids.alex, organizationId: ids.northstar }, async (tx) => ({
      services: await loadServices(tx, ids.northstar),
      book: await loadCustomerBook(tx, ids.northstar),
      team: await loadTeamData(tx, ids.northstar),
    }));
    expect(result.services).toEqual([]);
    expect(result.book).toEqual({ customers: [], properties: [], equipment: [] });
    expect(result.team).toEqual({ members: [], roles: [] });
  });
});

test.describe("the sample records keep their database identity", () => {
  test("the seeded rows have the deterministic ids the fixture bridge promises", async () => {
    const rows = await admin.query<{ kind: string; slug: string; id: string }>(
      `select 'customer' as kind, slug, id from customers where organization_id = $1
       union all select 'service', slug, id from services where organization_id = $1
       union all select 'member', slug, id from team_members where organization_id = $1
       union all select 'role', slug, id from team_roles where organization_id = $1
       union all select 'property', slug, id from customer_properties where organization_id = $1
       union all select 'equipment', slug, id from equipment where organization_id = $1`,
      [ids.apex],
    );
    expect(rows.rowCount).toBe(CUSTOMERS.length + SERVICES.length + TEAM.length + ROLES.length + PROPERTIES.length + EQUIPMENT.length);
    for (const row of rows.rows) expect(row.id, `${row.kind} ${row.slug}`).toBe(stableId(ids.apex, row.kind, row.slug));
  });

  test("a deterministic id is a valid version 5 UUID that depends on the business as well as the slug", () => {
    const id = stableId(ids.apex, "customer", "sarah-mitchell");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableId(ids.apex, "customer", "sarah-mitchell")).toBe(id);
    expect(stableId(ids.northstar, "customer", "sarah-mitchell")).not.toBe(id);
    expect(stableId(ids.apex, "service", "sarah-mitchell")).not.toBe(id);
  });

  test("the same slug in two businesses is two different rows", async () => {
    const rows = await admin.query<{ id: string; organization_id: string }>("select id, organization_id from services where slug = 'ac-repair-diagnostics' and organization_id in ($1, $2)", [ids.apex, ids.northstar]);
    expect(rows.rowCount).toBe(2);
    expect(new Set(rows.rows.map((row) => row.id)).size).toBe(2);
  });
});
