import type { Page } from "playwright/test";
import { SERVICES } from "../src/data/services";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const memberRows = (page: Page) => page.getByRole("table", { name: "Team members" }).locator("tbody tr");
const memberTabs = (page: Page, name: string) => page.getByRole("navigation", { name: `${name} sections` });
const summary = (page: Page) => page.getByRole("region", { name: "Team summary" });
const accessGroup = (page: Page, module: string) => page.getByRole("group", { name: `${module} access` });
/** The permission radios are visually hidden; click the visible label, assert on the radio. */
const chooseAccess = (page: Page, module: string, level: "No access" | "View" | "Manage") =>
  accessGroup(page, module).locator("label", { hasText: new RegExp(`^${level}$`) }).click();

async function addMember(page: Page, name = "Jordan Reyes", email = "jordan.reyes@example.com") {
  await page.goto("/team?add=1");
  const wizard = page.getByRole("dialog", { name: "Add team member" });
  await wizard.getByLabel("Name").fill(name);
  await wizard.getByLabel("Email").fill(email);
  await wizard.getByRole("button", { name: /^Next: Role/ }).click();
  await wizard.getByRole("button", { name: /^Next: Field access/ }).click();
  await wizard.getByRole("button", { name: /^Next: Availability/ }).click();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  await wizard.getByRole("button", { name: "Send invitation" }).click();
  return page.getByRole("dialog", { name: "Invitation sent" });
}

test.describe("Team list", () => {
  test("renders the approved header, summary tiles, filters and the three existing team members", async ({ page }) => {
    await page.goto("/team");
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await expect(page.getByText("Manage the people who work in Climvia and control what they can access.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Manage roles" })).toHaveAttribute("href", "/team/roles");
    await expect(page.getByRole("button", { name: "Add team member" }).first()).toBeVisible();

    await expect(summary(page)).toContainText("Total team members");
    await expect(summary(page)).toContainText("3 Active · 0 Pending invites");
    await expect(summary(page)).toContainText("Eligible for Job & Schedule assignment");
    await expect(summary(page)).toContainText("None pending");

    await expect(page.getByRole("table", { name: "Team members" }).getByRole("columnheader")).toHaveText([
      "Team member",
      "Role",
      "Field access",
      "Contact",
      "Availability",
      "Account status",
      "Action",
    ]);
    await expect(memberRows(page)).toHaveCount(3);
    await expect(memberRows(page).nth(0)).toContainText("Alex Morgan");
    await expect(memberRows(page).nth(0)).toContainText("Owner");
    await expect(memberRows(page).nth(0)).toContainText("Both (Owner & Field)");
    await expect(memberRows(page).nth(0)).toContainText("(512) 555-0100");
    await expect(memberRows(page).nth(1)).toContainText("Marcus Vance");
    await expect(memberRows(page).nth(1)).toContainText("marcus.v@apexclimate.com");
    await expect(memberRows(page).nth(1)).toContainText("Custom schedule");
    await expect(memberRows(page).nth(2)).toContainText("Samira Patel");
    for (const row of await memberRows(page).all()) await expect(row).toContainText("Active");
  });

  test("Alex has no invented email, and nothing about performance, payroll, GPS or utilization appears", async ({ page }) => {
    await page.goto("/team");
    await expect(memberRows(page).nth(0)).not.toContainText("@");
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const term of ["performance", "payroll", "commission", "utilization", "gps", "route", "dispatch", "rating"]) expect(text).not.toContain(term);
  });

  test("the team members are the same people Schedule and Jobs use", async ({ page }) => {
    await page.goto("/schedule?view=day");
    const row = page.getByRole("list", { name: "Technician timelines" }).getByRole("listitem").filter({ hasText: "Marcus Vance" });
    await expect(row).toContainText("Technician");
    await expect(row.locator("#event-JB-201")).toBeVisible();

    await page.goto("/jobs");
    await expect(page.getByRole("table", { name: "Active jobs" }).locator("tbody tr").filter({ hasText: "JB-201" })).toContainText("Marcus Vance");

    await page.goto("/team/marcus-vance");
    await expect(page.getByText("#JB-201").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "View job #JB-201" })).toHaveAttribute("href", "/jobs/JB-201");
  });

  test("search and filters narrow the list; Reset filters clears them", async ({ page }) => {
    await page.goto("/team");
    await page.getByLabel("Search team members").fill("samira");
    await expect(memberRows(page)).toHaveCount(1);
    await page.getByLabel("Search team members").fill("zzz");
    await expect(page.getByText("No team members match your filters.")).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(memberRows(page)).toHaveCount(3);

    await page.getByLabel("Role", { exact: true }).selectOption("technician");
    await expect(memberRows(page)).toHaveCount(2);
    await page.getByLabel("Role", { exact: true }).selectOption("all");
    await page.getByLabel("Classification", { exact: true }).selectOption("both");
    await expect(memberRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Reset filters" }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("invited");
    await expect(page.getByText("No team members match your filters.")).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).click();
    await page.getByLabel("Availability", { exact: true }).selectOption("custom");
    await expect(memberRows(page)).toHaveCount(1);
    await expect(memberRows(page).first()).toContainText("Marcus Vance");
  });

  test("the solo-owner state shows only the owner with the approved message", async ({ page }) => {
    await page.goto("/team?state=solo");
    await expect(memberRows(page)).toHaveCount(1);
    await expect(page.getByText("You’re currently the only person in this workspace.")).toBeVisible();
    await expect(summary(page)).toContainText("1 Active");
  });
});

test.describe("Team member detail", () => {
  test("Overview reads the member record and links to Jobs and Schedule", async ({ page }) => {
    await page.goto("/team/marcus-vance");
    await expect(page.getByRole("heading", { level: 1, name: "Marcus Vance" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Back to Team" })).toHaveAttribute("href", "/team");
    const header = page.locator("header").filter({ hasText: "Marcus Vance" }).last();
    await expect(header).toContainText("Technician");
    await expect(header).toContainText("Active");
    await expect(header).toContainText("marcus.v@apexclimate.com");
    await expect(header).toContainText("Member since March 2023");

    await expect(page.getByText("Senior HVAC Technician")).toBeVisible();
    await expect(page.getByText("Specializes in residential heat pump diagnostics")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Assignable to jobs" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("region", { name: "Weekly availability" })).toContainText("Mon–Fri, 8:00 AM – 4:30 PM");
    await expect(page.getByRole("region", { name: "Role & access" })).toContainText("Role: Technician");
    // No credentials, vehicle, device or score panels.
    await expect(page.getByText(/credential|license|vehicle|van #|security score|rating/i)).toHaveCount(0);
  });

  test("the five tabs are real routes, each reading the same member, and the shell never remounts", async ({ page }) => {
    await page.goto("/team/marcus-vance");
    await page.evaluate(() => {
      (document.querySelector("header") as unknown as { __tag: string }).__tag = "mounted-once";
    });
    const tabs = memberTabs(page, "Marcus Vance");
    await expect(tabs.getByRole("link")).toHaveText(["Overview", "Schedule & availability", "Permissions", /^Assigned services\s*6$/, "Activity"]);

    const routes: [string, string, RegExp][] = [
      ["Schedule & availability", "/team/marcus-vance/availability", /Availability configuration/],
      ["Permissions", "/team/marcus-vance/permissions", /Role: Technician/],
      ["Assigned services", "/team/marcus-vance/services", /Service assignment & eligibility/],
      ["Activity", "/team/marcus-vance/activity", /See changes to Marcus/],
      ["Overview", "/team/marcus-vance", /Profile & access/],
    ];
    for (const [label, url, content] of routes) {
      await tabs.getByRole("link", { name: new RegExp(`^${label}`) }).click();
      await expect(page).toHaveURL(url);
      await expect(tabs.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("aria-current", "page");
      await expect(page.getByText(content).first()).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Marcus Vance" })).toBeVisible();
    }
    expect(await page.evaluate(() => (document.querySelector("header") as unknown as { __tag?: string }).__tag)).toBe("mounted-once");
  });

  test("an unknown member shows a not-found state inside the shell", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/team/nobody-here");
    await expect(page.getByText("Team member not found")).toBeVisible();
    await expect(primaryNav(page)).toBeVisible();
  });

  test("Assignable to jobs can be switched off, and then the member is no longer offered for new work", async ({ page }) => {
    await page.goto("/team/marcus-vance");
    await page.getByRole("switch", { name: "Assignable to jobs" }).click();
    await expect(page.getByRole("switch", { name: "Assignable to jobs" })).toHaveAttribute("aria-checked", "false");

    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await page.getByRole("button", { name: "Create booking" }).click();
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByRole("radio", { name: /^Midday/ }).check();
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
    await expect(wizard.getByRole("radio", { name: /^Alex Morgan/ })).toBeVisible();
    await expect(wizard.getByRole("radio", { name: /^Marcus Vance/ })).toHaveCount(0);
  });
});

test.describe("Assigned services", () => {
  test("lists the six centralized services with their catalog details and links", async ({ page }) => {
    await page.goto("/team/marcus-vance/services");
    for (const service of SERVICES) {
      await expect(page.getByRole("checkbox", { name: new RegExp(`^${service.name.replace(/[/&]/g, ".")}`) })).toBeChecked();
      await expect(page.getByRole("link", { name: `Open ${service.name} in Services` })).toHaveAttribute("href", `/services/${service.id}`);
    }
    await expect(page.getByRole("checkbox")).toHaveCount(6);
    await expect(page.getByText("6 of 6 services assigned to Marcus Vance")).toBeVisible();
    await expect(page.getByText("Climvia doesn’t assign services automatically.")).toBeVisible();
    // Names and booking methods are read from the catalog.
    await expect(page.getByText("Ductless Mini-Split Installation & Estimate")).toBeVisible();
    await expect(page.getByText(/Request quote \/ assessment/)).toBeVisible();
  });

  test("selected services can be changed, discarded and saved; the tab count follows", async ({ page }) => {
    await page.goto("/team/marcus-vance/services");
    const save = page.getByRole("button", { name: "Save assigned services" });
    await expect(save).toBeDisabled();

    const ductless = page.getByRole("checkbox", { name: /^Ductless Mini-Split/ });
    await ductless.uncheck();
    await expect(page.getByText("5 of 6 services assigned")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(ductless).toBeChecked();

    await ductless.uncheck();
    await save.click();
    await expect(page.getByText("Assigned services for Marcus Vance saved.")).toBeVisible();
    await expect(memberTabs(page, "Marcus Vance").getByRole("link", { name: /^Assigned services/ })).toContainText("5");

    await page.getByRole("button", { name: "Deselect all" }).click();
    await expect(page.getByText("Select at least one service")).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole("button", { name: /^Select all/ }).click();
    await page.getByRole("radio", { name: /^All services/ }).check();
    await save.click();
    await expect(memberTabs(page, "Marcus Vance").getByRole("link", { name: /^Assigned services/ })).toContainText("6");
  });

  test("search filters the service list", async ({ page }) => {
    await page.goto("/team/marcus-vance/services");
    await page.getByLabel("Search services").fill("furnace");
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await page.getByLabel("Search services").fill("zzz");
    await expect(page.getByText("No services match your search.")).toBeVisible();
  });
});

test.describe("Permissions", () => {
  test("members inherit their role's permissions and the matrix is read-only until customized", async ({ page }) => {
    await page.goto("/team/marcus-vance/permissions");
    await expect(page.getByRole("radio", { name: /^Use role permissions \(Inherited from Technician\)/ })).toBeChecked();
    await expect(accessGroup(page, "Jobs").getByRole("radio", { name: "Manage" })).toBeChecked();
    await expect(accessGroup(page, "Schedule").getByRole("radio", { name: "View" })).toBeChecked();
    await expect(accessGroup(page, "Payments").getByRole("radio", { name: "No access" })).toBeChecked();
    await expect(accessGroup(page, "Settings").getByRole("radio", { name: "No access" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "View" }).first()).toBeDisabled();
    await expect(page.getByText("access to 8 of 16 modules")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save permissions" })).toBeDisabled();
    // Only the approved controls: three levels per module, no security / device / 2FA panels.
    await expect(page.getByText(/security score|2FA|device|webhook/i)).toHaveCount(0);
  });

  test("customizing, saving and resetting work in the session, without any sign-in or enforcement", async ({ page }) => {
    await page.goto("/team/marcus-vance/permissions");
    await page.getByRole("radio", { name: /^Customize permissions for Marcus Vance/ }).check();
    await chooseAccess(page, "Payments", "View");
    await expect(accessGroup(page, "Payments").getByRole("radio", { name: "View" })).toBeChecked();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save permissions" }).click();
    await expect(page.getByText("Permissions for Marcus Vance updated successfully.")).toBeVisible();

    // The change survives navigating away and back (same session) and is logged on the member.
    await memberTabs(page, "Marcus Vance").getByRole("link", { name: "Activity" }).click();
    await expect(page.getByText("Member-specific permissions set")).toBeVisible();
    await memberTabs(page, "Marcus Vance").getByRole("link", { name: "Permissions" }).click();
    await expect(page.getByRole("radio", { name: /^Customize permissions for Marcus Vance/ })).toBeChecked();
    await expect(accessGroup(page, "Payments").getByRole("radio", { name: "View" })).toBeChecked();

    await page.getByRole("button", { name: "Reset to Technician default" }).click();
    await page.getByRole("button", { name: "Save permissions" }).click();
    await expect(page.getByRole("radio", { name: /^Use role permissions/ })).toBeChecked();
    await expect(accessGroup(page, "Payments").getByRole("radio", { name: "No access" })).toBeChecked();

    // Reload restores the canonical team state.
    await page.reload();
    await expect(page.getByRole("radio", { name: /^Use role permissions/ })).toBeChecked();
  });

  test("the Owner's permissions are full and locked", async ({ page }) => {
    await page.goto("/team/alex-morgan/permissions");
    await expect(page.getByText("The Owner role has full access and can't be changed.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Customize permissions/ })).toBeDisabled();
    await expect(page.getByText("access to 16 of 16 modules")).toBeVisible();
  });
});

test.describe("Schedule & availability", () => {
  test("shows the member's availability configuration, separate from the Schedule events", async ({ page }) => {
    await page.goto("/team/marcus-vance/availability");
    await expect(page.getByRole("radio", { name: /^Custom availability/ })).toBeChecked();
    await expect(page.getByLabel("Monday start")).toHaveValue("08:00");
    await expect(page.getByLabel("Monday end")).toHaveValue("16:30");
    await expect(page.getByLabel("Monday break")).toHaveValue("12:00-12:30");
    await expect(page.getByRole("checkbox", { name: "Saturday" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Sunday" })).not.toBeChecked();

    // A heads-up about work already booked, but no calendar or events on this page.
    await expect(page.getByText("Upcoming assignment check · 1 active job")).toBeVisible();
    await expect(page.locator("[id^='event-']")).toHaveCount(0);
    await expect(page.getByText("Annual Vacation")).toBeVisible();
    await expect(page.getByText("Oct 14, 2024 – Oct 18, 2024")).toBeVisible();
    await expect(page.getByText("Nov 5, 2024 (8:00 AM – 1:00 PM)")).toBeVisible();
    await expect(page.getByText(/GPS|vehicle|van #|travel buffer|route/i)).toHaveCount(0);
  });

  test("changing hours, copying Monday to the weekdays and saving updates the member everywhere", async ({ page }) => {
    await page.goto("/team/marcus-vance/availability");
    await page.getByLabel("Monday end").selectOption("17:00");
    await page.getByRole("button", { name: "Copy Monday to all weekdays" }).click();
    await expect(page.getByLabel("Thursday end")).toHaveValue("17:00");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.getByText("Availability for Marcus Vance saved.")).toBeVisible();

    await page.goto("/team/marcus-vance/availability"); // reload: session resets, so use client navigation instead
    await expect(page.getByLabel("Monday end")).toHaveValue("16:30");
  });

  test("saved availability shows on Overview and in the Team list (client navigation keeps the session)", async ({ page }) => {
    await page.goto("/team/marcus-vance/availability");
    await page.getByLabel("Monday end").selectOption("17:00");
    await page.getByRole("button", { name: "Copy Monday to all weekdays" }).click();
    await page.getByRole("button", { name: "Save availability" }).click();

    await memberTabs(page, "Marcus Vance").getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Weekly availability" })).toContainText("Mon–Fri, 8:00 AM – 5:00 PM");
    await page.getByRole("link", { name: "Back to Team" }).click();
    await expect(memberRows(page).nth(1)).toContainText("Mon–Fri, 8:00 AM – 5:00 PM");
  });

  test("end time must be after start time", async ({ page }) => {
    await page.goto("/team/marcus-vance/availability");
    await page.getByLabel("Tuesday end").selectOption("07:00");
    await expect(page.getByText("End time must be after the start time.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save availability" })).toBeDisabled();
  });

  test("unavailable time can be added and removed; presets switch the weekly hours view", async ({ page }) => {
    await page.goto("/team/samira-patel/availability");
    await expect(page.getByRole("radio", { name: /^Uses business hours/ })).toBeChecked();
    await expect(page.getByText("No unavailable periods are scheduled.")).toBeVisible();

    await page.getByRole("button", { name: "Add unavailable time" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add unavailable time" });
    await dialog.getByRole("button", { name: "Add unavailable time" }).click();
    await expect(dialog.getByText(/Enter a name for this period/)).toBeVisible();
    await dialog.getByLabel("Name").fill("Training day");
    await dialog.getByLabel("Reason").selectOption("Training");
    await dialog.getByLabel("End date").fill("2024-10-26");
    await dialog.getByRole("button", { name: "Add unavailable time" }).click();
    await expect(page.getByText("Training day")).toBeVisible();
    await expect(page.getByText("Oct 25, 2024 – Oct 26, 2024 · Reason: Training")).toBeVisible();

    await page.getByRole("button", { name: "Save availability" }).click();
    await page.getByRole("button", { name: "Remove Training day" }).click();
    await expect(page.getByText("Training day")).toHaveCount(0);

    await page.getByRole("radio", { name: /^Set later/ }).check();
    await expect(page.getByText(/won’t be shown as available for assignment/)).toBeVisible();
    await page.getByRole("radio", { name: /^Custom availability/ }).check();
    await expect(page.getByLabel("Monday start")).toHaveValue("07:30");
  });
});

test.describe("Activity", () => {
  test("shows dated activity entries that can be filtered by category", async ({ page }) => {
    await page.goto("/team/marcus-vance/activity");
    await expect(page.getByRole("heading", { name: "Today (Oct 25)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Yesterday (Oct 24)" })).toBeVisible();
    await expect(page.getByText("Assigned to Job #JB-201")).toBeVisible();
    await expect(page.getByText("Invitation accepted & joined workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: /^All activity 8/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /^Jobs/ }).click();
    await expect(page.getByText("Working hours updated")).toHaveCount(0);
    await expect(page.getByText("Assigned to Job #JB-201")).toBeVisible();
    await expect(page.getByRole("link", { name: "View job" }).first()).toHaveAttribute("href", /\/jobs\/JB-/);

    await page.getByRole("button", { name: /^Availability/ }).click();
    await expect(page.getByText("Working hours updated")).toBeVisible();
    await expect(page.getByText(/audit|compliance|security log/i)).toHaveCount(0);
  });
});

test.describe("Add team member", () => {
  test("opens from the Team list with five steps and the approved fields", async ({ page }) => {
    await page.goto("/team");
    await page.getByRole("button", { name: "Add team member" }).first().click();
    const wizard = page.getByRole("dialog", { name: "Add team member" });
    await expect(page).toHaveURL(/\/team\?add=1$/);
    await expect(wizard.getByRole("list", { name: "Add team member steps" }).getByRole("listitem")).toHaveText([
      /Person/,
      /Role/,
      /Field access/,
      /Availability/,
      /Review/,
    ]);
    await expect(wizard.getByLabel("Email")).toBeVisible();
    await expect(wizard.getByLabel("Direct phone (optional)")).toBeVisible();
  });

  test("validates the person step with errors tied to the fields", async ({ page }) => {
    await page.goto("/team?add=1");
    const wizard = page.getByRole("dialog", { name: "Add team member" });
    await wizard.getByRole("button", { name: /^Next: Role/ }).click();
    await expect(wizard.getByText("Enter the person's name.")).toBeVisible();
    await expect(wizard.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(wizard.getByText("Enter an email address.")).toBeVisible();

    await wizard.getByLabel("Name").fill("Jordan Reyes");
    await wizard.getByLabel("Email").fill("not-an-email");
    await wizard.getByRole("button", { name: /^Next: Role/ }).click();
    await expect(wizard.getByText(/Enter a valid email address/)).toBeVisible();
    await wizard.getByLabel("Email").fill("marcus.v@apexclimate.com");
    await wizard.getByRole("button", { name: /^Next: Role/ }).click();
    await expect(wizard.getByText("A team member with this email address already exists.")).toBeVisible();
    await wizard.getByLabel("Email").fill("jordan.reyes@example.com");
    await wizard.getByRole("button", { name: /^Next: Role/ }).click();
    await expect(wizard.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(wizard.getByRole("heading", { level: 3 })).toContainText("step 2 of 5");
    // The Owner role is not something you invite someone into.
    await expect(wizard.getByRole("radio", { name: /^Owner/ })).toHaveCount(0);
    await expect(wizard.getByRole("radio", { name: /^Technician/ })).toBeChecked();
  });

  test("sends an in-session invitation: pending in the list, resendable, and not assignable", async ({ page }) => {
    const sent = await addMember(page);
    await expect(sent).toBeVisible();
    await expect(sent).toContainText("An invitation was sent to jordan.reyes@example.com.");
    await expect(sent).toContainText("Jordan Reyes · Invitation pending");
    await expect(sent).toContainText("Technician");
    await expect(sent).toContainText("Assignable to Jobs");

    await sent.getByRole("link", { name: "View team member" }).click();
    await expect(page).toHaveURL("/team/jordan-reyes");
    await expect(page.getByRole("heading", { level: 1, name: "Jordan Reyes" })).toBeVisible();
    await expect(page.locator("header").filter({ hasText: "Jordan Reyes" }).last()).toContainText("Invitation pending");

    await page.getByRole("link", { name: "Back to Team" }).click();
    await expect(memberRows(page)).toHaveCount(4);
    const row = memberRows(page).filter({ hasText: "Jordan Reyes" });
    await expect(row).toContainText("Invitation pending");
    await expect(summary(page)).toContainText("3 Active · 1 Pending invite");
    await expect(summary(page)).toContainText("Jordan Reyes");
    await row.getByRole("button", { name: "Resend invitation to Jordan Reyes" }).click();
    await expect(page.getByText("Invitation resent to jordan.reyes@example.com.")).toBeVisible();

    // A pending invitation can't be given work yet.
    await primaryNav(page).getByRole("link", { name: "Jobs" }).click();
    await page.getByRole("button", { name: "Assign technician to job JB-198" }).click();
    const assign = page.getByRole("dialog", { name: "Assign technician" });
    await expect(assign.getByRole("radio", { name: /^Samira Patel/ })).toBeVisible();
    await expect(assign.getByRole("radio", { name: /^Jordan Reyes/ })).toHaveCount(0);

    // Nothing was sent or stored: a reload clears it.
    await page.goto("/team");
    await expect(memberRows(page)).toHaveCount(3);
  });

  test("Add another team member starts over, and Escape closes the wizard", async ({ page }) => {
    const sent = await addMember(page);
    await sent.getByRole("button", { name: "Add another team member" }).click();
    const wizard = page.getByRole("dialog", { name: "Add team member" });
    await expect(wizard.getByLabel("Name")).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/team$/);
  });
});

test.describe("Deactivate member", () => {
  test("a member with upcoming work must have it reassigned first, by hand", async ({ page }) => {
    await page.goto("/team/marcus-vance");
    await page.getByRole("button", { name: "Deactivate member" }).click();
    const dialog = page.getByRole("dialog", { name: "Deactivate Marcus Vance?" });
    await expect(dialog).toContainText("Climvia access");
    await expect(dialog).toContainText("Removed");
    await expect(dialog).toContainText("Historical Jobs & activity");
    await expect(dialog).toContainText("Preserved");
    await expect(dialog).toContainText("Marcus has 1 upcoming Job assignment");
    await expect(dialog).toContainText("#JB-201 · David Chen");
    await expect(dialog).toContainText("Climvia does not automatically reassign scheduled Jobs");
    await expect(dialog.getByRole("link", { name: "View job #JB-201" })).toHaveAttribute("href", "/jobs/JB-201");
    await expect(dialog.getByRole("button", { name: "Deactivate member" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Reassign JB-201" }).click();
    const assign = page.getByRole("dialog", { name: "Assign technician" });
    await expect(assign.getByRole("radio", { name: /^Marcus Vance/ })).toHaveCount(0); // not offered to himself
    await assign.getByRole("radio", { name: /^Samira Patel/ }).check();
    await assign.getByRole("button", { name: "Save assignment" }).click();

    await expect(dialog).toContainText("No upcoming Job assignments");
    await expect(dialog.getByRole("button", { name: "Deactivate member" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Deactivate member" }).click();
    await expect(page.getByText("Marcus Vance was deactivated.")).toBeVisible();
    await expect(page.locator("header").filter({ hasText: "Marcus Vance" }).last()).toContainText("Inactive");
    await expect(page.getByRole("button", { name: "Deactivate member" })).toHaveCount(0);
  });

  test("deactivation updates the Team list and assignment pickers but never rewrites history", async ({ page }) => {
    await page.goto("/team/marcus-vance");
    await page.getByRole("button", { name: "Deactivate member" }).click();
    const dialog = page.getByRole("dialog", { name: "Deactivate Marcus Vance?" });
    await dialog.getByRole("button", { name: "Reassign JB-201" }).click();
    await page.getByRole("dialog", { name: "Assign technician" }).getByRole("radio", { name: /^Samira Patel/ }).check();
    await page.getByRole("dialog", { name: "Assign technician" }).getByRole("button", { name: "Save assignment" }).click();
    await dialog.getByRole("button", { name: "Deactivate member" }).click();

    await page.getByRole("link", { name: "Back to Team" }).click();
    await expect(memberRows(page).nth(1)).toContainText("Marcus Vance");
    await expect(memberRows(page).nth(1)).toContainText("Inactive");
    await expect(summary(page)).toContainText("2 Active");

    // The completed job Marcus did still names him; the reassigned one is Samira's by the user's own choice.
    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await page.getByRole("tab", { name: /^Completed/ }).click();
    await expect(page.getByRole("table", { name: "Completed jobs" }).locator("tbody tr").filter({ hasText: "JB-186" })).toContainText("Marcus Vance");
    await page.getByRole("tab", { name: /^Active/ }).click();
    await expect(page.getByRole("table", { name: "Active jobs" }).locator("tbody tr").filter({ hasText: "JB-201" })).toContainText("Samira Patel");

    // His past work is still on the Schedule under his name, but he can't be assigned anything new.
    await primaryNav(page).getByRole("link", { name: "Schedule" }).click();
    await page.getByRole("tab", { name: "Day" }).click();
    await expect(page.getByRole("list", { name: "Technician timelines" }).getByRole("listitem").filter({ hasText: "Marcus Vance" }).locator("#event-JB-186")).toBeVisible();
    await page.getByRole("button", { name: "Assign technician to Elena Rodriguez" }).click();
    await expect(page.getByRole("dialog", { name: "Assign technician" }).getByRole("radio", { name: /^Marcus Vance/ })).toHaveCount(0);
  });

  test("a member with no upcoming work can be deactivated straight away; the owner can't be", async ({ page }) => {
    const sent = await addMember(page);
    await sent.getByRole("link", { name: "View team member" }).click();
    await page.getByRole("button", { name: "Deactivate member" }).click();
    const dialog = page.getByRole("dialog", { name: "Deactivate Jordan Reyes?" });
    await expect(dialog).toContainText("No upcoming Job assignments");
    await expect(dialog.getByRole("button", { name: "Deactivate member" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate member" })).toBeFocused();

    await primaryNav(page).getByRole("link", { name: "Team" }).click();
    await page.getByRole("link", { name: "View member Alex Morgan" }).click();
    await expect(page.getByRole("button", { name: "Deactivate member" })).toHaveCount(0);
  });
});

test.describe("Roles", () => {
  test("lists the seven roles with types, members and the protected Owner", async ({ page }) => {
    await page.goto("/team/roles");
    await expect(page.getByRole("heading", { level: 1, name: "Roles & permissions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Team" })).toHaveAttribute("href", "/team");
    await expect(page.getByRole("tablist", { name: "Role types" }).getByRole("tab")).toHaveText([/^All\s*7$/, /^System\s*6$/, /^Custom\s*1$/]);
    await expect(page.getByRole("article")).toHaveCount(7);

    const owner = page.getByRole("article", { name: "Owner" });
    await expect(owner).toContainText("System role · Protected");
    await expect(owner).toContainText("Alex Morgan");
    await expect(owner.getByRole("link", { name: "View permissions for Owner" })).toBeVisible();
    await expect(owner.getByRole("link", { name: /^Edit/ })).toHaveCount(0);

    const technician = page.getByRole("article", { name: "Technician" });
    await expect(technician).toContainText("Marcus Vance");
    await expect(technician).toContainText("Samira Patel");
    await expect(page.getByRole("article", { name: "Bookkeeper" })).toContainText("0 members");
    await expect(page.getByRole("article", { name: "Service Manager" })).toContainText("Custom role");

    await page.getByRole("tab", { name: /^Custom/ }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByLabel("Search roles").fill("zzz");
    await expect(page.getByText("No roles match your search.")).toBeVisible();
  });

  test("Role detail shows the permission matrix and its members; edits apply to people who inherit the role", async ({ page }) => {
    await page.goto("/team/roles/technician");
    await expect(page.getByRole("heading", { level: 1, name: "Technician" })).toBeVisible();
    await expect(page.getByLabel("Role name")).toHaveValue("Technician");
    await expect(page.getByRole("complementary", { name: "Assigned members" })).toContainText("2 team members currently using the Technician role.");
    await expect(accessGroup(page, "Jobs").getByRole("radio", { name: "Manage" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await expect(page.getByText("Changes to this role apply immediately to 2 team members.")).toBeVisible();

    await chooseAccess(page, "Payments", "View");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Technician role updated.")).toBeVisible();

    await page.getByRole("complementary", { name: "Assigned members" }).getByRole("link", { name: "Marcus Vance" }).click();
    await memberTabs(page, "Marcus Vance").getByRole("link", { name: "Permissions" }).click();
    await expect(accessGroup(page, "Payments").getByRole("radio", { name: "View" })).toBeChecked();
    await memberTabs(page, "Marcus Vance").getByRole("link", { name: "Activity" }).click();
    await expect(page.getByText("Inheriting updated Technician role defaults").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today (Oct 25)" })).toBeVisible();
  });

  test("system role names are fixed, the Owner role is read-only, and unknown roles show a not-found state", async ({ page, consoleGuard }) => {
    await page.goto("/team/roles/technician");
    await expect(page.getByLabel("Role name")).toHaveAttribute("readonly", "");

    await page.goto("/team/roles/owner");
    await expect(page.getByText("The Owner role always has full access and can't be edited.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "No access" }).first()).toBeDisabled();

    consoleGuard.allow(/status of 404/);
    await page.goto("/team/roles/not-a-role");
    await expect(page.getByText("Role not found")).toBeVisible();
  });

  test("Create role validates the name, copies a template's permissions and adds a custom role", async ({ page }) => {
    await page.goto("/team/roles/new");
    await expect(page.getByRole("heading", { level: 1, name: "Create role" })).toBeVisible();
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByText("Enter a role name.")).toBeVisible();
    await page.getByLabel("Role name").fill("Technician");
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByText("A role with this name already exists.")).toBeVisible();

    await page.getByLabel("Role name").fill("Parts Coordinator");
    await page.getByRole("radio", { name: "Technician" }).check();
    await expect(accessGroup(page, "Jobs").getByRole("radio", { name: "Manage" })).toBeChecked();
    await chooseAccess(page, "Payments", "View");
    await page.getByRole("radio", { name: "Blank permissions" }).check();
    await expect(accessGroup(page, "Jobs").getByRole("radio", { name: "No access" })).toBeChecked();
    await chooseAccess(page, "Jobs", "View");
    await page.getByRole("button", { name: "Create role" }).click();

    await expect(page).toHaveURL("/team/roles");
    await expect(page.getByText("Parts Coordinator role created.")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Role types" }).getByRole("tab", { name: /^Custom/ })).toContainText("2");
    await expect(page.getByRole("article", { name: "Parts Coordinator" })).toContainText("Custom role");
    await page.getByRole("link", { name: "Edit Parts Coordinator role" }).click();
    await expect(accessGroup(page, "Jobs").getByRole("radio", { name: "View" })).toBeChecked();
  });

  test("Duplicate opens Create role with that role's permissions as the starting point", async ({ page }) => {
    await page.goto("/team/roles");
    await page.getByRole("link", { name: "Duplicate Technician role" }).click();
    await expect(page).toHaveURL(/\/team\/roles\/new\?from=technician$/);
    await expect(page.getByLabel("Role name")).toHaveValue("Technician copy");
    await expect(page.getByRole("radio", { name: "Technician" })).toBeChecked();
    await expect(accessGroup(page, "Jobs").getByRole("radio", { name: "Manage" })).toBeChecked();
  });

  test("new members can be invited into a custom role", async ({ page }) => {
    await page.goto("/team/roles/new");
    await page.getByLabel("Role name").fill("Parts Coordinator");
    await page.getByRole("button", { name: "Create role" }).click();
    await page.getByRole("link", { name: "Back to Team" }).click();
    await page.getByRole("button", { name: "Add team member" }).first().click();
    const wizard = page.getByRole("dialog", { name: "Add team member" });
    await wizard.getByLabel("Name").fill("Pat Lee");
    await wizard.getByLabel("Email").fill("pat.lee@example.com");
    await wizard.getByRole("button", { name: /^Next: Role/ }).click();
    await expect(wizard.getByRole("radio", { name: /^Parts Coordinator/ })).toBeVisible();
  });
});
