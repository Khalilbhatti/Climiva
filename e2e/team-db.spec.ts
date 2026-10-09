/**
 * The Team from PostgreSQL (Phase 10, tests 24–37).
 *
 * Each worker signs in to its own copy of the Apex organization; its team is put back to the approved three people and seven
 * roles before every test that changed it. The two seed businesses are only READ here (Alex is Apex, Taylor is Northstar).
 */
import type { Page } from "playwright/test";
import { DIR, TEAM } from "./apex-data";
import { getAssigneeName } from "../src/data/operations";
import { NORTHSTAR_TEAM } from "../scripts/db/seed-data/northstar";
import { expect, test, toast } from "./saas";

const memberRows = (page: Page) => page.getByRole("table", { name: "Team members" }).locator("tbody tr");
const bodyText = (page: Page) => page.locator("body").innerText();
const accessGroup = (page: Page, module: string) => page.getByRole("group", { name: `${module} access` });
/** The permission radios are visually hidden; click the visible label, assert on the radio. */
const chooseAccess = (page: Page, module: string, level: "No access" | "View" | "Manage") => accessGroup(page, module).locator("label", { hasText: new RegExp(`^${level}$`) }).click();

const APEX_TEAM = TEAM.map((member) => member.name);
const NORTHSTAR_PEOPLE = NORTHSTAR_TEAM.map((member) => member.name);

/** Adds an active technician with no upcoming work, straight to the database (the way another admin's session would have). */
async function insertTechnician(db: import("pg").Pool, organizationId: string, slug = "riley-stone", name = "Riley Stone") {
  await db.query(
    `insert into team_members (organization_id, slug, name, job_title, role_id, status, field_assignable, service_mode, availability_mode)
     select $1, $2, $3, 'Technician', r.id, 'active', true, 'all', 'business-hours' from team_roles r where r.organization_id = $1 and r.slug = 'technician'`,
    [organizationId, slug, name],
  );
}

test.describe("the Team comes from the database", () => {
  test("24. the Team list comes from the database", async ({ page, db, workerTenant }) => {
    const stored = await db.query<{ name: string }>("select name from team_members where organization_id = $1 order by position", [workerTenant.organizationId]);
    expect(stored.rows.map((row) => row.name)).toEqual(APEX_TEAM);

    await page.goto("/team");
    await expect(memberRows(page)).toHaveCount(3);
    for (const name of APEX_TEAM) await expect(memberRows(page).filter({ hasText: name })).toHaveCount(1);

    // A team member written to the database by anyone appears; the page is not a copy.
    await insertTechnician(db, workerTenant.organizationId);
    await page.reload();
    await expect(memberRows(page)).toHaveCount(4);
    await expect(memberRows(page).filter({ hasText: "Riley Stone" })).toContainText("Technician");
  });

  test("25. Marcus Vance is persisted as approved", async ({ page, db, workerTenant }) => {
    const row = (
      await db.query<{ name: string; title: string | null; email: string; phone: string; status: string; field_assignable: boolean; role: string; availability_mode: string }>(
        `select m.name, m.title, m.email, m.phone, m.status, m.field_assignable, r.name as role, m.availability_mode
         from team_members m join team_roles r on r.organization_id = m.organization_id and r.id = m.role_id
         where m.organization_id = $1 and m.slug = 'marcus-vance'`,
        [workerTenant.organizationId],
      )
    ).rows[0];
    expect(row).toEqual({
      name: "Marcus Vance",
      title: "Senior HVAC Technician",
      email: "marcus.v@apexclimate.com",
      phone: "(512) 555-0144",
      status: "active",
      field_assignable: true,
      role: "Technician",
      availability_mode: "custom",
    });
    const children = await db.query<{ days: number; periods: number; services: number }>(
      `select (select count(*)::int from team_member_availability a where a.member_id = m.id) as days,
              (select count(*)::int from team_member_unavailable_periods p where p.member_id = m.id) as periods,
              (select count(*)::int from team_member_services s where s.member_id = m.id) as services
       from team_members m where m.organization_id = $1 and m.slug = 'marcus-vance'`,
      [workerTenant.organizationId],
    );
    expect(children.rows[0]).toEqual({ days: 7, periods: 2, services: 6 });

    await page.goto("/team/marcus-vance");
    await expect(page.getByRole("heading", { level: 1, name: "Marcus Vance" })).toBeVisible();
    await expect(page.locator("main")).toContainText("marcus.v@apexclimate.com");
    await expect(page.locator("main")).toContainText("(512) 555-0144");
    await expect(page.locator("main")).toContainText("Senior HVAC Technician");
  });

  test("26. Samira Patel is persisted as approved", async ({ page, db, workerTenant }) => {
    const row = (
      await db.query<{ name: string; title: string | null; email: string; status: string; role: string }>(
        `select m.name, m.title, m.email, m.status, r.name as role
         from team_members m join team_roles r on r.organization_id = m.organization_id and r.id = m.role_id
         where m.organization_id = $1 and m.slug = 'samira-patel'`,
        [workerTenant.organizationId],
      )
    ).rows[0];
    expect(row).toEqual({ name: "Samira Patel", title: "Apprentice Technician", email: "samira.hvac@gmail.com", status: "active", role: "Technician" });

    await page.goto("/team/samira-patel");
    await expect(page.getByRole("heading", { level: 1, name: "Samira Patel" })).toBeVisible();
    await expect(page.locator("main")).toContainText("samira.hvac@gmail.com");
    await expect(page.locator("main")).toContainText("Apprentice Technician");
  });

  test("27. Alex's Team record stays separate from Alex's Profile", async ({ page, db, workerTenant }) => {
    // The two are different tables with no copy of each other's fields; the optional link is a login id, not a profile.
    const columns = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'team_members'")).rows.map((row) => row.column_name);
    expect(columns).not.toContain("profile_id");
    expect(columns).not.toContain("full_name");
    expect(columns).toContain("user_id");

    // Renaming the Profile does not rename the Team record.
    await page.goto("/settings/profile");
    await page.getByLabel(/^Full name/).fill("Alexandra Morgan");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(toast(page)).toContainText("Profile updated.");
    await page.goto("/team/alex-morgan");
    await expect(page.getByRole("heading", { level: 1, name: "Alex Morgan" })).toBeVisible();
    expect((await db.query("select name from team_members where organization_id = $1 and slug = 'alex-morgan'", [workerTenant.organizationId])).rows[0].name).toBe("Alex Morgan");

    // And renaming the Team record does not rename the Profile.
    await db.query("update team_members set name = 'Alex M. Morgan' where organization_id = $1 and slug = 'alex-morgan'", [workerTenant.organizationId]);
    await page.goto("/team/alex-morgan");
    await expect(page.getByRole("heading", { level: 1, name: "Alex M. Morgan" })).toBeVisible();
    await page.goto("/settings/profile");
    await expect(page.getByLabel(/^Full name/)).toHaveValue("Alexandra Morgan");
    expect((await db.query("select full_name from profiles where user_id = $1", [workerTenant.userId])).rows[0].full_name).toBe("Alexandra Morgan");
  });

  test("28. the Roles screens load the roles stored for the business", async ({ page, db, workerTenant }) => {
    const roles = (await db.query<{ name: string }>("select name from team_roles where organization_id = $1 order by position", [workerTenant.organizationId])).rows.map((row) => row.name);
    expect(roles).toHaveLength(7);
    expect(roles).toContain("Owner");

    await page.goto("/team/roles");
    for (const name of roles) await expect(page.locator("main")).toContainText(name);

    await db.query("update team_roles set description = 'Changed in the database.' where organization_id = $1 and slug = 'technician'", [workerTenant.organizationId]);
    await page.goto("/team/roles/technician");
    await expect(page.getByLabel("Role description")).toHaveValue("Changed in the database.");
  });

  test("29. permission and role configuration changes persist", async ({ page, db, workerTenant }) => {
    await page.goto("/team/roles/technician");
    await chooseAccess(page, "Payments", "View");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page)).toContainText("Technician role updated.");
    await page.reload();
    await expect(accessGroup(page, "Payments").getByRole("radio", { name: "View" })).toBeChecked();
    const role = (await db.query<{ permissions: Record<string, string> }>("select permissions from team_roles where organization_id = $1 and slug = 'technician'", [workerTenant.organizationId])).rows[0];
    expect(role.permissions.payments).toBe("view");

    // A member's own override is stored on the member, and the role is left alone.
    await page.goto("/team/samira-patel/permissions");
    await page.getByRole("radio", { name: /^Customize permissions for Samira Patel/ }).check();
    await chooseAccess(page, "Reviews", "Manage");
    await page.getByRole("button", { name: "Save permissions" }).click();
    await expect(page.getByText("Permissions for Samira Patel updated successfully.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("radio", { name: /^Customize permissions for Samira Patel/ })).toBeChecked();
    const override = (await db.query<{ permission_override: Record<string, string> | null }>("select permission_override from team_members where organization_id = $1 and slug = 'samira-patel'", [workerTenant.organizationId])).rows[0];
    expect(override.permission_override?.reviews).toBe("manage");
  });

  test("30. availability persists", async ({ page, db, workerTenant }) => {
    await page.goto("/team/marcus-vance/availability");
    await page.getByLabel("Monday end").selectOption("17:00");
    await page.getByRole("button", { name: "Copy Monday to all weekdays" }).click();
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Availability for Marcus Vance saved.")).toBeVisible();

    const ends = await db.query<{ day_of_week: number; end_time: string }>(
      `select a.day_of_week, a.end_time from team_member_availability a join team_members m on m.organization_id = a.organization_id and m.id = a.member_id
       where m.organization_id = $1 and m.slug = 'marcus-vance' and a.enabled order by a.day_of_week`,
      [workerTenant.organizationId],
    );
    expect(ends.rows.map((row) => row.end_time.slice(0, 5))).toEqual(["17:00", "17:00", "17:00", "17:00", "17:00"]);
    await page.reload();
    await expect(page.getByLabel("Monday end")).toHaveValue("17:00");
    await expect(page.getByLabel("Friday end")).toHaveValue("17:00");
  });

  test("31. assigned services use the business's Service records", async ({ page, db, workerTenant }) => {
    await page.goto("/team/samira-patel/services");
    const stored = (await db.query<{ name: string }>("select name from services where organization_id = $1 and is_active order by display_order", [workerTenant.organizationId])).rows.map((row) => row.name);
    expect(stored).toHaveLength(6);
    for (const name of stored) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    // A Service switched off in the database leaves the list of what can be assigned.
    await db.query("update services set is_active = false where organization_id = $1 and slug = 'furnace-safety-inspection'", [workerTenant.organizationId]);
    await page.reload();
    await expect(page.getByText("Furnace Safety Inspection & Tune-Up", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Select all \(5\)/ })).toBeVisible();

    // What is chosen is stored as references to those Service rows, not as copies of them.
    await page.getByRole("radio", { name: /^Selected services/ }).check();
    await page.getByRole("button", { name: "Deselect all" }).click();
    await page.getByRole("checkbox", { name: /^AC Repair & Diagnostics/ }).check();
    await page.getByRole("checkbox", { name: /^Annual Cooling Tune-Up/ }).check();
    await page.getByRole("button", { name: "Save assigned services" }).click();
    await expect(page.getByText("Assigned services for Samira Patel saved.")).toBeVisible();
    const assigned = await db.query<{ slug: string }>(
      `select s.slug from team_member_services t
       join team_members m on m.organization_id = t.organization_id and m.id = t.member_id
       join services s on s.organization_id = t.organization_id and s.id = t.service_id
       where m.organization_id = $1 and m.slug = 'samira-patel' order by s.slug`,
      [workerTenant.organizationId],
    );
    expect(assigned.rows.map((row) => row.slug)).toEqual(["ac-repair-diagnostics", "annual-cooling-tune-up"]);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /^AC Repair & Diagnostics/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /^Heat Pump Diagnostics/ })).not.toBeChecked();
  });

  test("32. deactivating persists, and leaves the login and the history alone", async ({ page, db, workerTenant }) => {
    await insertTechnician(db, workerTenant.organizationId);
    const memberships = async () => (await db.query<{ n: number }>("select count(*)::int as n from organization_memberships where organization_id = $1", [workerTenant.organizationId])).rows[0].n;
    const before = await memberships();

    await page.goto("/team/riley-stone");
    await page.getByRole("button", { name: "Deactivate member" }).click();
    const dialog = page.getByRole("dialog", { name: "Deactivate Riley Stone?" });
    await expect(dialog).toContainText("No upcoming Job assignments");
    await dialog.getByRole("button", { name: "Deactivate member" }).click();
    await expect(page.getByText("Riley Stone was deactivated.")).toBeVisible();

    const stored = await db.query<{ status: string; entries: number }>(
      `select m.status, (select count(*)::int from team_activity a where a.member_id = m.id and a.title = 'Team member deactivated') as entries
       from team_members m where m.organization_id = $1 and m.slug = 'riley-stone'`,
      [workerTenant.organizationId],
    );
    expect(stored.rows[0]).toEqual({ status: "inactive", entries: 1 });
    expect(await memberships()).toBe(before);

    await page.reload();
    await expect(page.locator("header").filter({ hasText: "Riley Stone" }).last()).toContainText("Inactive");
    await expect(page.getByRole("button", { name: "Deactivate member" })).toHaveCount(0);
    await page.goto("/team");
    await expect(memberRows(page).filter({ hasText: "Riley Stone" })).toContainText("Inactive");
  });

  test("33. a deactivated team member is no longer offered for new work", async ({ page, db, workerTenant }) => {
    await insertTechnician(db, workerTenant.organizationId);
    const offered = async () => {
      await page.goto("/jobs");
      await page.getByRole("button", { name: "Assign technician to job JB-198" }).click();
      const assign = page.getByRole("dialog", { name: "Assign technician" });
      await expect(assign.getByRole("radio", { name: /^Samira Patel/ })).toBeVisible();
      return assign.getByRole("radio", { name: /^Riley Stone/ }).count();
    };
    expect(await offered()).toBe(1);

    await page.goto("/team/riley-stone");
    await page.getByRole("button", { name: "Deactivate member" }).click();
    await page.getByRole("dialog", { name: "Deactivate Riley Stone?" }).getByRole("button", { name: "Deactivate member" }).click();
    await expect(page.getByText("Riley Stone was deactivated.")).toBeVisible();

    expect(await offered()).toBe(0);
  });

  test("34. history that names a deactivated or unknown team member still displays safely", async ({ page, db, workerTenant }) => {
    await db.query("update team_members set status = 'inactive' where organization_id = $1 and slug = 'marcus-vance'", [workerTenant.organizationId]);

    // The completed job Marcus did still names him; nothing was rewritten and the page does not break.
    await page.goto("/jobs/JB-186");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText("Marcus Vance");
    await page.goto("/jobs");
    await page.getByRole("tab", { name: /^Completed/ }).click();
    await expect(page.getByRole("table", { name: "Completed jobs" }).locator("tbody tr").filter({ hasText: "JB-186" })).toContainText("Marcus Vance");
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();

    // A record that points at someone who is not on the team reads as unassigned instead of failing.
    expect(getAssigneeName({ assigneeId: "someone-who-left" }, DIR)).toBeUndefined();
    expect(getAssigneeName({ assigneeId: undefined }, DIR)).toBeUndefined();
  });
});

test.describe("the Team belongs to one business", () => {
  test("35. Northstar cannot see Apex's Team", async ({ openAs, apiAs }) => {
    const { page, problems } = await openAs("taylor");
    await page.goto("/team");
    await expect(memberRows(page)).toHaveCount(NORTHSTAR_PEOPLE.length);
    const text = await bodyText(page);
    for (const name of APEX_TEAM) expect(text, name).not.toContain(name);
    const secrets = ["marcus.v@apexclimate.com", "samira.hvac@gmail.com", "(512) 555-0144", ...APEX_TEAM];
    const api = await apiAs("taylor");
    const html = await (await api.get("/team")).text();
    for (const secret of secrets) expect(html, secret).not.toContain(secret);
    for (const slug of ["marcus-vance", "samira-patel", "alex-morgan"]) expect((await api.get(`/team/${slug}`)).status(), slug).toBe(404);
    expect(problems).toEqual([]);
  });

  test("36. Apex cannot see Northstar's Team", async ({ openAs, apiAs }) => {
    const { page, problems } = await openAs("alex");
    await page.goto("/team");
    await expect(memberRows(page)).toHaveCount(APEX_TEAM.length);
    const text = await bodyText(page);
    for (const name of NORTHSTAR_PEOPLE) expect(text, name).not.toContain(name);
    const api = await apiAs("alex");
    const html = await (await api.get("/team")).text();
    for (const secret of ["jordan.pike@northstar-hvac.test", "(720) 555-0144", ...NORTHSTAR_PEOPLE]) expect(html, secret).not.toContain(secret);
    for (const slug of ["jordan-pike", "taylor-brooks"]) expect((await api.get(`/team/${slug}`)).status(), slug).toBe(404);
    expect(problems).toEqual([]);
  });

  test("37. a team member cannot be assigned another business's Service", async ({ db }) => {
    const client = await db.connect();
    try {
      await client.query("begin");
      let failure: { code?: string; message?: string } | undefined;
      try {
        await client.query(
          `insert into team_member_services (organization_id, member_id, service_id)
           select m.organization_id, m.id, s.id
           from team_members m, services s
           where m.organization_id = (select id from organizations where slug = 'northstar-heating-cooling') and m.slug = 'jordan-pike'
             and s.organization_id = (select id from organizations where slug = 'apex-climate-heating-air') and s.slug = 'ac-repair-diagnostics'`,
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
