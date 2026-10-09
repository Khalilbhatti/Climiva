/**
 * Customers, properties and equipment from PostgreSQL (Phase 10, tests 1–12).
 *
 * The Apex copy each worker signs in to is a real organization with real rows: these specs change a row with the owner
 * connection and watch the page follow, so they can tell a database read from records compiled into the page. The two
 * seed businesses are only ever READ here (Alex is Apex, Taylor is Northstar, see tenant-isolation.spec.ts).
 */
import type { Page } from "playwright/test";
import { CUSTOMERS, EQUIPMENT, PROPERTIES } from "./apex-data";
import { completeOnboarding, expect, NOT_SIGNED_IN, signUp, test } from "./saas";

const APEX_NAMES = CUSTOMERS.map((customer) => customer.name);
const NORTHSTAR_NAMES = ["Marta Olsen", "Priya Raman"];

const rows = (page: Page) => page.getByRole("table", { name: "Customers" }).locator("tbody tr");
const nameCells = (page: Page) => rows(page).locator("td:first-child .whitespace-nowrap");

/** What a page shows to a person: the visible text of the whole body. */
const bodyText = (page: Page) => page.locator("body").innerText();

test.describe("Customers come from the database", () => {
  test("1. the Apex customer list comes from the database", async ({ page, db, workerTenant }) => {
    const stored = await db.query<{ name: string }>("select name from customers where organization_id = $1 order by position", [workerTenant.organizationId]);
    expect(stored.rows.map((row) => row.name)).toEqual(APEX_NAMES);

    await page.goto("/customers");
    await expect(rows(page)).toHaveCount(stored.rows.length);
    await expect(nameCells(page)).toHaveText(APEX_NAMES);

    // Change a row behind the app's back: the page follows, so it is a read of the database and not a copy.
    await db.query("update customers set phone = '(512) 555-0199' where organization_id = $1 and slug = 'sarah-mitchell'", [workerTenant.organizationId]);
    await page.reload();
    await expect(rows(page).filter({ hasText: "Sarah Mitchell" })).toContainText("(512) 555-0199");
  });

  test("2. Sarah Mitchell exists, in the list and as a record", async ({ page, db, workerTenant }) => {
    const row = (await db.query<{ email: string; phone: string }>("select email, phone from customers where organization_id = $1 and slug = 'sarah-mitchell'", [workerTenant.organizationId])).rows[0];
    expect(row).toBeDefined();

    await page.goto("/customers");
    await expect(rows(page).filter({ hasText: "Sarah Mitchell" })).toHaveCount(1);
    await page.getByRole("link", { name: "View customer Sarah Mitchell" }).click();
    await expect(page).toHaveURL("/customers/sarah-mitchell");
    await expect(page.getByRole("heading", { level: 1, name: "Sarah Mitchell" })).toBeVisible();
    await expect(page.locator("main")).toContainText(row.email);
  });

  test("3. Sarah has exactly the canonical Home property", async ({ page, db, workerTenant }) => {
    const properties = await db.query<{ label: string; address_line1: string; city: string; state_region: string; postal_code: string }>(
      `select p.label, p.address_line1, p.city, p.state_region, p.postal_code
       from customer_properties p join customers c on c.organization_id = p.organization_id and c.id = p.customer_id
       where p.organization_id = $1 and c.slug = 'sarah-mitchell'`,
      [workerTenant.organizationId],
    );
    expect(properties.rows).toEqual([{ label: "Home", address_line1: "1402 Kinney Ave", city: "Austin", state_region: "TX", postal_code: "78704" }]);

    await page.goto("/customers/sarah-mitchell/properties");
    await expect(page.getByRole("navigation", { name: "Sarah Mitchell sections" })).toContainText(`1 prop · ${EQUIPMENT.filter((item) => item.propertyId === "prop-sarah-home").length} sys`);
    // One property section, and it is the canonical Home.
    const sections = page.locator("main section[aria-labelledby$='-heading']");
    await expect(sections).toHaveCount(1);
    await expect(sections.first().getByRole("heading", { level: 2 })).toHaveText(/^1402 Kinney Ave, Austin, TX 78704/);
    await expect(sections.first()).toContainText("Home");
  });

  test("4. the stale South Lamar property does not exist", async ({ page, db, workerTenant }) => {
    const stale = await db.query("select 1 from customer_properties where organization_id = $1 and (address_line1 ilike '%lamar%' or area ilike '%lamar%' or access_instructions ilike '%lamar%')", [workerTenant.organizationId]);
    expect(stale.rowCount).toBe(0);
    expect(PROPERTIES.some((property) => /lamar/i.test(`${property.street} ${property.area ?? ""}`))).toBe(false);

    for (const path of ["/customers", "/customers/sarah-mitchell", "/customers/sarah-mitchell/properties"]) {
      await page.goto(path);
      expect(await bodyText(page), path).not.toMatch(/South Lamar/i);
    }
  });

  test("5. equipment loads from the database", async ({ page, db, workerTenant }) => {
    const stored = await db.query<{ name: string; serial_number: string }>(
      `select e.name, e.serial_number from equipment e join customer_properties p on p.organization_id = e.organization_id and p.id = e.property_id
       where e.organization_id = $1 and p.slug = 'prop-sarah-home' order by e.position`,
      [workerTenant.organizationId],
    );
    const expected = EQUIPMENT.filter((item) => item.propertyId === "prop-sarah-home");
    expect(stored.rows.map((row) => row.name)).toEqual(expected.map((item) => item.name));

    await page.goto("/customers/sarah-mitchell/properties");
    for (const item of stored.rows) await expect(page.locator("main")).toContainText(item.name);

    await db.query("update equipment set serial_number = 'ZZ-TEST-0001' where organization_id = $1 and slug = 'eq-sarah-heat-pump'", [workerTenant.organizationId]);
    await page.reload();
    await expect(page.locator("main")).toContainText("ZZ-TEST-0001");
  });

  test("6. Elena's surname is Rodriguez, in the database and on every screen", async ({ page, db, workerTenant }) => {
    const names = await db.query<{ name: string }>("select name from customers where organization_id = $1 and slug = 'elena-rodriguez'", [workerTenant.organizationId]);
    expect(names.rows).toEqual([{ name: "Elena Rodriguez" }]);
    const stray = await db.query("select 1 from customers c left join customer_notes n on n.organization_id = c.organization_id and n.customer_id = c.id where c.organization_id = $1 and (c.name ilike '%rostova%' or n.body ilike '%rostova%')", [workerTenant.organizationId]);
    expect(stray.rowCount).toBe(0);

    for (const path of ["/customers", "/customers/elena-rodriguez"]) {
      await page.goto(path);
      await expect(page.locator("main")).toContainText("Elena Rodriguez");
      expect(await bodyText(page), path).not.toMatch(/Rostova/i);
    }
  });

  test("7. customer data persists after a reload and for a fresh sign-in", async ({ page, browser, workerTenant }) => {
    await page.goto("/customers");
    const before = await nameCells(page).allInnerTexts();
    expect(before).toEqual(APEX_NAMES);
    await page.reload();
    expect(await nameCells(page).allInnerTexts()).toEqual(before);

    await page.goto("/customers/sarah-mitchell/properties");
    const property = await page.locator("main").innerText();
    await page.reload();
    expect(await page.locator("main").innerText()).toBe(property);

    // A different browser session for the same person reads the same stored rows.
    const other = await browser.newContext({ storageState: workerTenant.storageState, baseURL: process.env.BETTER_AUTH_URL });
    try {
      const second = await other.newPage();
      await second.goto("/customers");
      expect(await nameCells(second).allInnerTexts()).toEqual(before);
    } finally {
      await other.close();
    }
  });
});

test.describe("Customers belong to one business", () => {
  test("8. Northstar cannot read Apex's customers", async ({ openAs, apiAs }) => {
    const { page, problems } = await openAs("taylor");
    await page.goto("/customers");
    await expect(nameCells(page)).toHaveText(NORTHSTAR_NAMES);
    const apexSecrets = CUSTOMERS.flatMap((customer) => [customer.name, customer.email, customer.phone]);
    const text = await bodyText(page);
    for (const secret of apexSecrets) expect(text, secret).not.toContain(secret);

    // Not on the page and not in the raw response either.
    const api = await apiAs("taylor");
    const html = await (await api.get("/customers")).text();
    for (const secret of apexSecrets) expect(html, secret).not.toContain(secret);
    expect(problems).toEqual([]);
  });

  test("9. Apex cannot read Northstar's customers", async ({ openAs, apiAs, db }) => {
    const northstar = await db.query<{ name: string; email: string; phone: string }>(
      "select c.name, c.email, c.phone from customers c join organizations o on o.id = c.organization_id where o.slug = 'northstar-heating-cooling'",
    );
    expect(northstar.rows.map((row) => row.name).sort()).toEqual([...NORTHSTAR_NAMES].sort());
    const secrets = northstar.rows.flatMap((row) => [row.name, row.email, row.phone]);

    const { page, problems } = await openAs("alex");
    await page.goto("/customers");
    await expect(nameCells(page)).toHaveText(APEX_NAMES);
    const text = await bodyText(page);
    for (const secret of secrets) expect(text, secret).not.toContain(secret);

    const api = await apiAs("alex");
    const html = await (await api.get("/customers")).text();
    for (const secret of secrets) expect(html, secret).not.toContain(secret);
    expect(problems).toEqual([]);
  });

  test("10. asking for a customer by another business's slug or by any uuid reveals nothing", async ({ apiAs, db }) => {
    const ids = await db.query<{ id: string; slug: string; org: string }>(
      "select c.id, c.slug, o.slug as org from customers c join organizations o on o.id = c.organization_id where c.slug in ('marta-olsen', 'sarah-mitchell') and o.slug in ('northstar-heating-cooling', 'apex-climate-heating-air')",
    );
    const foreignUuid = ids.rows.find((row) => row.org === "northstar-heating-cooling")!.id;
    const ownUuid = ids.rows.find((row) => row.org === "apex-climate-heating-air")!.id;

    const alex = await apiAs("alex");
    const answers = new Map<string, { status: number; body: string }>();
    for (const reference of ["marta-olsen", foreignUuid, ownUuid, "nobody-by-that-name", "00000000-0000-0000-0000-000000000000"]) {
      for (const suffix of ["", "/properties"]) {
        const response = await alex.get(`/customers/${reference}${suffix}`);
        answers.set(`${reference}${suffix}`, { status: response.status(), body: await response.text() });
      }
    }
    for (const [reference, answer] of answers) {
      expect(answer.status, reference).toBe(404);
      for (const secret of [...NORTHSTAR_NAMES, "marta.olsen@northstar-clients.test", "55 Juniper Court"]) expect(answer.body, `${reference}: ${secret}`).not.toContain(secret);
    }
    // A customer of another business answers exactly as one that never existed does.
    expect(answers.get("marta-olsen")!.status).toBe(answers.get("nobody-by-that-name")!.status);
    expect(answers.get(foreignUuid)!.status).toBe(answers.get("00000000-0000-0000-0000-000000000000")!.status);
  });

  test.describe("a new business", () => {
    test.use({ storageState: NOT_SIGNED_IN });

    test("11. a new organization has a Customers empty state and none of Apex's customers", async ({ page }) => {
      await signUp(page);
      await completeOnboarding(page, { name: "Blank Slate Cooling" });
      await page.goto("/customers");
      await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No customers yet" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Customers" })).toHaveCount(0);
      const text = await bodyText(page);
      for (const name of [...APEX_NAMES, ...NORTHSTAR_NAMES]) expect(text, name).not.toContain(name);
    });
  });

  test("12. a property cannot be attached to another business's customer", async ({ db }) => {
    const client = await db.connect();
    try {
      await client.query("begin");
      let failure: { code?: string; message?: string } | undefined;
      try {
        await client.query(
          `insert into customer_properties (organization_id, customer_id, slug, label, address_line1, city, state_region, postal_code)
           select (select id from organizations where slug = 'apex-climate-heating-air'), c.id, 'zz-stray', 'Home', '1 A St', 'Austin', 'TX', '78701'
           from customers c join organizations o on o.id = c.organization_id where o.slug = 'northstar-heating-cooling' limit 1`,
        );
      } catch (error) {
        failure = error as { code?: string; message?: string };
      }
      expect(failure?.code).toBe("23503");
      expect(failure?.message).toMatch(/customer_properties_customer_fk/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});
