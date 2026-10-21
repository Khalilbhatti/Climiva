/**
 * Services from PostgreSQL (Phase 10, tests 13–23).
 *
 * Each worker signs in to its own copy of the Apex organization; the copy is put back to the canonical six Services before
 * every test that changed it. The two seed businesses are only READ here (Alex is Apex, Taylor is Northstar).
 */
import type { Page } from "playwright/test";
import { PLANS, SERVICES } from "./apex-data";
import { completeOnboarding, expect, NOT_SIGNED_IN, signUp, test, toast } from "./saas";

const NORTHSTAR_SERVICES = ["Cooling Diagnostic Visit", "Furnace Tune-Up", "Radiant Heat Estimate"];
const rows = (page: Page) => page.getByRole("table", { name: "Services" }).locator("tbody tr");
const bodyText = (page: Page) => page.locator("body").innerText();

/** What the approved catalog says, written out literally so a change to the seed cannot change the test with it. */
const CANONICAL: { slug: string; name: string; category: string; minutes: number; model: string; price: string | null; method: string }[] = [
  { slug: "ac-repair-diagnostics", name: "AC Repair & Diagnostics", category: "Cooling", minutes: 90, model: "diagnostic-fee", price: "89.00", method: "request-appointment" },
  { slug: "annual-cooling-tune-up", name: "Annual Cooling Tune-Up & Maintenance", category: "Maintenance", minutes: 60, model: "fixed-price", price: "129.00", method: "instant" },
  { slug: "heat-pump-diagnostics-repair", name: "Heat Pump Diagnostics & Repair", category: "Heat pumps", minutes: 90, model: "diagnostic-fee", price: "99.00", method: "request-appointment" },
  { slug: "emergency-no-heat-no-cool", name: "Emergency No-Heat / No-Cool Service", category: "Emergency", minutes: 60, model: "diagnostic-fee", price: "149.00", method: "request-appointment" },
  { slug: "ductless-mini-split-estimate", name: "Ductless Mini-Split Installation & Estimate", category: "Cooling", minutes: 120, model: "free-assessment", price: null, method: "request-quote" },
  { slug: "furnace-safety-inspection", name: "Furnace Safety Inspection & Tune-Up", category: "Heating", minutes: 60, model: "fixed-price", price: "119.00", method: "instant" },
];

test.describe("Services come from the database", () => {
  test("13. Apex has exactly its six canonical Services, each as approved", async ({ db, workerTenant }) => {
    const stored = await db.query<{ slug: string; name: string; category: string; duration_minutes: number; pricing_model: string; price_amount: string | null; booking_method: string; is_active: boolean }>(
      "select slug, name, category, duration_minutes, pricing_model, price_amount, booking_method, is_active from services where organization_id = $1 order by display_order",
      [workerTenant.organizationId],
    );
    expect(stored.rows).toHaveLength(6);
    expect(stored.rows.map((row) => row.slug)).toEqual(CANONICAL.map((service) => service.slug));
    for (const [index, expected] of CANONICAL.entries()) {
      expect(stored.rows[index], expected.name).toMatchObject({
        name: expected.name,
        category: expected.category,
        duration_minutes: expected.minutes,
        pricing_model: expected.model,
        price_amount: expected.price,
        booking_method: expected.method,
        is_active: true,
      });
    }
    // The Emergency record is preserved as its own Service, and the seed data the app is tested against agrees.
    expect(stored.rows.find((row) => row.slug === "emergency-no-heat-no-cool")?.category).toBe("Emergency");
    expect(SERVICES.map((service) => service.id)).toEqual(CANONICAL.map((service) => service.slug));
  });

  test("14. a Maintenance Plan's visit labels are not Services, and the public catalog is exactly the six", async ({ page, db, workerTenant }) => {
    const names = (await db.query<{ name: string }>("select name from services where organization_id = $1", [workerTenant.organizationId])).rows.map((row) => row.name.toLowerCase());
    const planLabels = PLANS.flatMap((plan) => plan.visits.map((visit) => visit.label.toLowerCase()));
    expect(planLabels.length).toBeGreaterThan(0);
    for (const label of planLabels) expect(names, label).not.toContain(label);

    const publicOnes = await db.query("select 1 from services where organization_id = $1 and is_active and visibility in ('public-booking', 'public-only')", [workerTenant.organizationId]);
    expect(publicOnes.rowCount).toBe(6);

    await page.goto("/website/preview/services");
    for (const service of CANONICAL) await expect(page.locator("body"), service.name).toContainText(service.name);
    for (const label of new Set(["Cooling maintenance", "Heating maintenance"])) await expect(page.locator("body"), label).not.toContainText(label);
  });

  test("15. the Services list comes from the database", async ({ page, db, workerTenant }) => {
    await page.goto("/services");
    await expect(rows(page)).toHaveCount(6);
    await db.query("update services set name = 'AC Repair and Diagnostic Visit' where organization_id = $1 and slug = 'ac-repair-diagnostics'", [workerTenant.organizationId]);
    await page.reload();
    await expect(rows(page).first()).toContainText("AC Repair and Diagnostic Visit");
    await expect(rows(page)).toHaveCount(6);
  });

  test("16. a Service's detail comes from the database", async ({ page, db, workerTenant }) => {
    await db.query("update services set price_amount = 95, description = 'Changed in the database.' where organization_id = $1 and slug = 'ac-repair-diagnostics'", [workerTenant.organizationId]);
    await page.goto("/services/ac-repair-diagnostics");
    await expect(page.getByLabel("Customer-facing description")).toHaveValue("Changed in the database.");
    await page.goto("/services/ac-repair-diagnostics/pricing");
    await expect(page.getByLabel("Fee amount (USD)")).toHaveValue("95");
  });

  test("17. Save persists after a reload, and Discard persists nothing", async ({ page, db, workerTenant }) => {
    const price = async () => (await db.query<{ price_amount: string }>("select price_amount from services where organization_id = $1 and slug = 'ac-repair-diagnostics'", [workerTenant.organizationId])).rows[0].price_amount;

    await page.goto("/services/ac-repair-diagnostics/pricing");
    await page.getByLabel("Fee amount (USD)").fill("97");
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByLabel("Fee amount (USD)")).toHaveValue("89");
    await page.reload();
    await expect(page.getByLabel("Fee amount (USD)")).toHaveValue("89");
    expect(await price()).toBe("89.00");

    await page.getByLabel("Fee amount (USD)").fill("97");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page).filter({ hasText: "Service changes saved." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    expect(await price()).toBe("97.00");
    await page.reload();
    await expect(page.getByLabel("Fee amount (USD)")).toHaveValue("97");
    await page.goto("/services");
    await expect(rows(page).first()).toContainText("$97 diagnostic fee");
  });

  test("18. Add Service persists, in this business only", async ({ page, db, workerTenant }) => {
    await page.goto("/services");
    await page.getByRole("button", { name: "Add service" }).click();
    const wizard = page.getByRole("dialog", { name: "Add new service" });
    await wizard.getByLabel("Service name").fill("Zephyr Duct Cleaning");
    await wizard.getByLabel("Customer-facing description").fill("Whole-home duct cleaning, added by the browser tests.");
    await wizard.getByRole("button", { name: /^Next: How customers book/ }).click();
    await wizard.getByRole("radio", { name: /^Instant booking/ }).check();
    await wizard.getByRole("button", { name: /^Next: Pricing/ }).click();
    await wizard.getByLabel("Fee amount (USD)").or(wizard.getByLabel("Price (USD)")).fill("75");
    await wizard.getByRole("button", { name: /^Next: Where customers see it/ }).click();
    await wizard.getByRole("button", { name: /^Next: Review/ }).click();
    await wizard.getByRole("button", { name: "Add service" }).click();
    await expect(toast(page).filter({ hasText: "Zephyr Duct Cleaning was added to your services." })).toBeVisible();
    await expect(rows(page)).toHaveCount(7);

    const stored = await db.query<{ organization_id: string; slug: string }>("select organization_id, slug from services where name = 'Zephyr Duct Cleaning'");
    expect(stored.rows).toEqual([{ organization_id: workerTenant.organizationId, slug: "zephyr-duct-cleaning" }]);

    await page.reload();
    await expect(rows(page)).toHaveCount(7);
    await expect(rows(page).filter({ hasText: "Zephyr Duct Cleaning" })).toHaveCount(1);
    await page.goto("/services/zephyr-duct-cleaning");
    await expect(page.getByRole("heading", { level: 1, name: "Zephyr Duct Cleaning" })).toBeVisible();
  });

  test("19. Deactivate persists after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/services/furnace-safety-inspection");
    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog", { name: "Deactivate Furnace Safety Inspection & Tune-Up?" }).getByRole("button", { name: "Deactivate service" }).click();
    await expect(toast(page).filter({ hasText: "Furnace Safety Inspection & Tune-Up deactivated." })).toBeVisible();

    const active = async () => (await db.query<{ is_active: boolean }>("select is_active from services where organization_id = $1 and slug = 'furnace-safety-inspection'", [workerTenant.organizationId])).rows[0].is_active;
    expect(await active()).toBe(false);

    await page.reload();
    await expect(page.getByRole("button", { name: "Activate" })).toBeVisible();
    await page.goto("/services");
    await expect(rows(page).filter({ hasText: "Furnace Safety Inspection" })).toContainText("Inactive");
    // And it can be switched back on.
    await page.goto("/services/furnace-safety-inspection");
    await page.getByRole("button", { name: "Activate" }).click();
    await expect(toast(page).filter({ hasText: "Furnace Safety Inspection & Tune-Up activated." })).toBeVisible();
    expect(await active()).toBe(true);
  });
});

test.describe("Services belong to one business", () => {
  test("20. an Apex Service never appears in Northstar", async ({ openAs, apiAs }) => {
    const { page, problems } = await openAs("taylor");
    await page.goto("/services");
    await expect(rows(page)).toHaveCount(NORTHSTAR_SERVICES.length);
    const text = await bodyText(page);
    for (const service of CANONICAL) expect(text, service.name).not.toContain(service.name);
    for (const name of NORTHSTAR_SERVICES) expect(text, name).toContain(name);

    // The same address means each business's own Service: Northstar's "ac-repair-diagnostics" is not Apex's.
    await page.goto("/services/ac-repair-diagnostics");
    await expect(page.getByRole("heading", { level: 1, name: "Cooling Diagnostic Visit" })).toBeVisible();
    expect(await bodyText(page)).not.toContain("AC Repair & Diagnostics");

    const api = await apiAs("taylor");
    expect((await api.get("/services/annual-cooling-tune-up")).status()).toBe(404);
    const html = await (await api.get("/services")).text();
    for (const service of CANONICAL) expect(html, service.name).not.toContain(service.name);
    expect(problems.filter((problem) => !/status of 404/.test(problem))).toEqual([]);
  });

  test("21. a Northstar Service never appears in Apex", async ({ openAs, apiAs }) => {
    const { page, problems } = await openAs("alex");
    await page.goto("/services");
    await expect(rows(page)).toHaveCount(6);
    const text = await bodyText(page);
    for (const name of NORTHSTAR_SERVICES) expect(text, name).not.toContain(name);

    const api = await apiAs("alex");
    for (const slug of ["furnace-tune-up", "radiant-heat-estimate"]) expect((await api.get(`/services/${slug}`)).status(), slug).toBe(404);
    const html = await (await api.get("/services")).text();
    for (const name of NORTHSTAR_SERVICES) expect(html, name).not.toContain(name);
    expect(problems).toEqual([]);
  });

  test.describe("a new business", () => {
    test.use({ storageState: NOT_SIGNED_IN });

    test("22. a new organization gets the Services empty state, with no starter catalog", async ({ page }) => {
      await signUp(page);
      await completeOnboarding(page, { name: "Blank Slate Cooling" });
      await page.goto("/services");
      await expect(page.getByRole("heading", { name: "No services configured yet" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add service" })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Load standard HVAC starter services" })).toHaveCount(0);
      await expect(page.getByRole("table")).toHaveCount(0);
      const text = await bodyText(page);
      for (const service of [...CANONICAL.map((item) => item.name), ...NORTHSTAR_SERVICES]) expect(text, service).not.toContain(service);
    });
  });

  test("23. a team member cannot be given another business's Service", async ({ db }) => {
    const client = await db.connect();
    try {
      await client.query("begin");
      let failure: { code?: string; message?: string } | undefined;
      try {
        await client.query(
          `insert into team_member_services (organization_id, member_id, service_id)
           select m.organization_id, m.id, s.id
           from team_members m, services s
           where m.organization_id = (select id from organizations where slug = 'apex-climate-heating-air') and m.slug = 'marcus-vance'
             and s.organization_id = (select id from organizations where slug = 'northstar-heating-cooling') and s.slug = 'furnace-tune-up'`,
        );
      } catch (error) {
        failure = error as { code?: string; message?: string };
      }
      expect(failure?.code).toBe("23503");
      expect(failure?.message).toMatch(/team_member_services_service_fk/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});
