import { expect, test } from "playwright/test";
import { BOOKINGS, JOBS, OPERATIONS, SCHEDULE_BLOCKS, getJobById } from "../src/data/operations";
import { SERVICES } from "../src/data/services";
import {
  CLASSIFICATION_LABEL,
  MODULE_IDS,
  ROLES,
  TEAM,
  TEAM_DATA,
  buildPermissions,
  countAccessibleModules,
  describeAvailability,
  getAssignableMembers,
  getAssignedServiceIds,
  getClassification,
  getEffectivePermissions,
  getMemberById,
  getMembersForRole,
  getRoleById,
  getTeamMemberById,
  summarizeWeek,
  weeklyFromBusinessHours,
} from "../src/data/team";
import { businessHoursByWeekday } from "../src/data/fixtures";
import { formatTime } from "../src/lib/dates";
import {
  addInvitedMember,
  createRole,
  deactivateMember,
  resendInvitation,
  setAvailability,
  setFieldAssignable,
  setPermissionOverride,
  setServiceEligibility,
  slugify,
  updateRole,
} from "../src/lib/team-state";

// Pure data/selector/state tests: no browser needed.

const snapshot = () => JSON.stringify(TEAM_DATA);
const input = { name: "Jordan Reyes", email: "jordan@example.com", phone: "(512) 555-0111", roleId: "technician", fieldAssignable: true, availabilityMode: "business-hours" as const };
const ACTIVE_SERVICE_IDS = SERVICES.filter((service) => service.active).map((service) => service.id);

test.describe("one team dataset", () => {
  test("Team uses the same three identities as Bookings, Schedule and Jobs", () => {
    expect(TEAM.map((member) => member.id)).toEqual(["alex-morgan", "marcus-vance", "samira-patel"]);
    for (const record of [...BOOKINGS, ...JOBS]) if (record.assigneeId) expect(getTeamMemberById(record.assigneeId), record.id).toBeDefined();
    for (const block of SCHEDULE_BLOCKS) for (const id of block.memberIds) expect(getTeamMemberById(id), block.id).toBeDefined();
    expect(getTeamMemberById("marcus-vance")).toBe(getMemberById("marcus-vance"));
  });

  test("Marcus Vance is a Technician with the approved contact details; Alex has a phone but no invented email", () => {
    expect(getMemberById("marcus-vance")).toMatchObject({
      name: "Marcus Vance",
      role: "Technician",
      roleId: "technician",
      email: "marcus.v@apexclimate.com",
      phone: "(512) 555-0144",
      status: "active",
    });
    const alex = getMemberById("alex-morgan")!;
    expect(alex).toMatchObject({ name: "Alex Morgan", role: "Operations Lead", roleId: "owner", phone: "(512) 555-0100" });
    expect(alex.email).toBeUndefined();
    // Nobody has an email or phone that an approved screen does not carry.
    expect(TEAM.filter((member) => member.email).map((member) => member.email)).toEqual(["marcus.v@apexclimate.com", "samira.hvac@gmail.com"]);
  });

  test("no technician fleet: exactly three members, and no Elena on the team", () => {
    expect(TEAM).toHaveLength(3);
    expect(JSON.stringify(TEAM)).not.toMatch(/Elena|Rostova/);
  });

  test("access roles: seven roles, six system and one custom, the Owner is protected", () => {
    expect(ROLES.map((role) => role.name)).toEqual([
      "Owner",
      "Administrator",
      "Office & Scheduling",
      "Technician",
      "Apprentice",
      "Bookkeeper",
      "Service Manager",
    ]);
    expect(ROLES.filter((role) => role.kind === "system")).toHaveLength(6);
    expect(ROLES.filter((role) => role.kind === "custom").map((role) => role.id)).toEqual(["service-manager"]);
    expect(getRoleById("owner")?.protected).toBe(true);
    for (const role of ROLES) expect(Object.keys(role.permissions).sort(), role.id).toEqual([...MODULE_IDS].sort());
  });

  test("the Technician role matches the approved access: Jobs manage, Schedule/Customers/Services view, no Team, Payments or Settings", () => {
    const technician = getRoleById("technician")!.permissions;
    expect(technician).toMatchObject({ jobs: "manage", schedule: "view", customers: "view", services: "view", team: "none", payments: "none", settings: "none" });
    expect(countAccessibleModules(getRoleById("owner")!.permissions)).toBe(16);
  });

  test("roles list their members; members read their permissions from the role unless overridden", () => {
    expect(getMembersForRole("technician").map((member) => member.id)).toEqual(["marcus-vance", "samira-patel"]);
    expect(getMembersForRole("owner").map((member) => member.id)).toEqual(["alex-morgan"]);
    expect(getMembersForRole("bookkeeper")).toEqual([]);
    const marcus = getMemberById("marcus-vance")!;
    expect(getEffectivePermissions(marcus)).toBe(getRoleById("technician")!.permissions);
  });

  test("classification follows the role and field access", () => {
    expect(getClassification(getMemberById("alex-morgan")!)).toBe("both");
    expect(getClassification(getMemberById("marcus-vance")!)).toBe("field");
    expect(getClassification({ ...getMemberById("marcus-vance")!, fieldAssignable: false })).toBe("office");
    expect(CLASSIFICATION_LABEL.both).toBe("Both (Owner & Field)");
    expect(getAssignableMembers().map((member) => member.id)).toEqual(["alex-morgan", "marcus-vance", "samira-patel"]);
  });
});

test.describe("availability and services", () => {
  test("availability is configuration, derived from the business hours where it says so", () => {
    expect(weeklyFromBusinessHours()[5]).toEqual({ enabled: true, start: "07:30", end: "18:00" });
    expect(weeklyFromBusinessHours()[0].enabled).toBe(false);
    for (const day of [0, 1, 2, 3, 4, 5, 6]) expect(weeklyFromBusinessHours()[day].enabled).toBe(Boolean(businessHoursByWeekday[day]));

    const alex = describeAvailability(getMemberById("alex-morgan")!.availability);
    expect(alex.title).toBe("Uses business hours");
    expect(alex.detail).toBe("Mon–Fri 7:30 AM–6:00 PM · Sat 8:00 AM–2:00 PM");

    const marcus = getMemberById("marcus-vance")!.availability;
    expect(marcus.mode).toBe("custom");
    expect(summarizeWeek(marcus.weekly, formatTime)).toBe("Mon–Fri, 8:00 AM – 4:30 PM");
    expect(marcus.weekly[1]).toMatchObject({ breakStart: "12:00", breakEnd: "12:30" });
    expect(marcus.unavailable.map((period) => period.title)).toEqual(["Annual Vacation", "Advanced Heat Pump Diagnostics Seminar"]);
    expect(describeAvailability({ mode: "not-set", weekly: marcus.weekly, unavailable: [] })).toEqual({ title: "Not set", detail: "Pending setup" });
  });

  test("assigned services are ids from the six-service catalog, never copies", () => {
    expect(ACTIVE_SERVICE_IDS).toHaveLength(6);
    for (const member of TEAM) {
      for (const id of member.serviceIds) expect(ACTIVE_SERVICE_IDS, `${member.id}: ${id}`).toContain(id);
      expect(getAssignedServiceIds(member, ACTIVE_SERVICE_IDS)).toHaveLength(6);
    }
    expect(getAssignedServiceIds({ ...TEAM[1], serviceMode: "all", serviceIds: [] }, ACTIVE_SERVICE_IDS)).toEqual(ACTIVE_SERVICE_IDS);
    expect(getAssignedServiceIds({ ...TEAM[1], serviceMode: "selected", serviceIds: ["ac-repair-diagnostics", "not-a-service"] }, ACTIVE_SERVICE_IDS)).toEqual(["ac-repair-diagnostics"]);
  });

  test("every booking and job is for a service its assignee is eligible for", () => {
    for (const record of [...BOOKINGS, ...JOBS]) {
      if (!record.assigneeId) continue;
      const member = getMemberById(record.assigneeId)!;
      expect(getAssignedServiceIds(member, ACTIVE_SERVICE_IDS), `${record.id}: ${record.serviceId}`).toContain(record.serviceId);
    }
  });

  test("activity entries reference real jobs and team members", () => {
    for (const member of TEAM) {
      for (const entry of member.activity) {
        if (entry.jobId) expect(getJobById(entry.jobId), entry.id).toBeDefined();
        if (entry.byId) expect(getTeamMemberById(entry.byId), entry.id).toBeDefined();
      }
    }
  });
});

test.describe("in-memory team state", () => {
  test("add member: a pending invitation, never assignable, with an invitation activity entry", () => {
    const before = snapshot();
    const { data, member } = addInvitedMember(TEAM_DATA, input);
    expect(member).toMatchObject({ id: "jordan-reyes", name: "Jordan Reyes", status: "invited", roleId: "technician", role: "Technician", serviceMode: "all" });
    expect(member.activity[0]).toMatchObject({ title: "Invitation sent", byId: "alex-morgan" });
    expect(data.members).toHaveLength(4);
    expect(getAssignableMembers(data).map((item) => item.id)).not.toContain("jordan-reyes");
    expect(getMembersForRole("technician", data)).toHaveLength(3);
    expect(snapshot()).toBe(before);

    // A second person with the same name gets a different id; resending only logs an entry.
    const twin = addInvitedMember(data, { ...input, email: "jordan2@example.com" });
    expect(twin.member.id).toBe("jordan-reyes-2");
    expect(getMemberById("jordan-reyes", resendInvitation(data, "jordan-reyes"))!.activity[0].title).toBe("Invitation resent");
    expect(resendInvitation(data, "marcus-vance")).toEqual(data); // only pending invitations can be resent
    expect(slugify("  Maria José O'Neil ")).toBe("maria-jos-o-neil");
  });

  test("deactivate: the member becomes Inactive and unassignable; history and operations are untouched", () => {
    const opsBefore = JSON.stringify(OPERATIONS);
    const data = deactivateMember(TEAM_DATA, "marcus-vance");

    const marcus = getMemberById("marcus-vance", data)!;
    expect(marcus.status).toBe("inactive");
    expect(marcus.activity[0].title).toBe("Account deactivated");
    expect(getAssignableMembers(data).map((item) => item.id)).toEqual(["alex-morgan", "samira-patel"]);
    expect(getMembersForRole("technician", data).map((item) => item.id)).toEqual(["samira-patel"]);

    // The name still resolves, and the completed job that names Marcus is exactly as it was.
    expect(getTeamMemberById("marcus-vance")?.name).toBe("Marcus Vance");
    expect(getJobById("JB-186")).toMatchObject({ assigneeId: "marcus-vance", status: "completed" });
    expect(JSON.stringify(OPERATIONS)).toBe(opsBefore);

    // The workspace owner can't be deactivated; doing it twice changes nothing more.
    expect(getMemberById("alex-morgan", deactivateMember(TEAM_DATA, "alex-morgan"))!.status).toBe("active");
    expect(deactivateMember(data, "marcus-vance")).toEqual(data);
  });

  test("permissions: an override is member-specific and clearing it goes back to the role", () => {
    const custom = buildPermissions("view", { payments: "manage" });
    const data = setPermissionOverride(TEAM_DATA, "marcus-vance", custom);
    expect(getEffectivePermissions(getMemberById("marcus-vance", data)!, data)).toBe(custom);
    expect(getEffectivePermissions(getMemberById("samira-patel", data)!, data)).toBe(getRoleById("technician")!.permissions);

    const reset = setPermissionOverride(data, "marcus-vance", undefined);
    expect(getMemberById("marcus-vance", reset)!.permissionOverride).toBeUndefined();
    expect(getMemberById("marcus-vance", reset)!.activity[0]).toMatchObject({ category: "access", title: "Permissions updated", detail: "Inheriting Technician role defaults" });
    expect(snapshot()).toBe(JSON.stringify(TEAM_DATA));
  });

  test("roles: edit changes what inheriting members get; the Owner role and unknown roles are left alone", () => {
    const next = buildPermissions("none", { payments: "view" });
    const data = updateRole(TEAM_DATA, "technician", { description: "Field work.", permissions: next });
    expect(getEffectivePermissions(getMemberById("marcus-vance", data)!, data)).toBe(next);
    expect(getMemberById("samira-patel", data)!.activity[0].detail).toBe("Inheriting updated Technician role defaults");

    // A member with their own override is not affected.
    const overridden = updateRole(setPermissionOverride(TEAM_DATA, "marcus-vance", buildPermissions("none")), "technician", { permissions: next });
    expect(getMemberById("marcus-vance", overridden)!.activity[0].detail).toBe("Member-specific permissions set");

    expect(updateRole(TEAM_DATA, "owner", { permissions: next })).toBe(TEAM_DATA);
    expect(updateRole(TEAM_DATA, "no-such-role", { description: "x" })).toBe(TEAM_DATA);
  });

  test("create role: a custom role with its own id; the template is copied, not shared", () => {
    const { data, role } = createRole(TEAM_DATA, { name: " Parts Coordinator ", description: "", permissions: getRoleById("technician")!.permissions });
    expect(role).toMatchObject({ id: "parts-coordinator", name: "Parts Coordinator", kind: "custom", description: "Custom role." });
    expect(data.roles).toHaveLength(8);
    expect(getMembersForRole("parts-coordinator", data)).toEqual([]);
    expect(createRole(data, { name: "Parts Coordinator", permissions: role.permissions }).role.id).toBe("parts-coordinator-2");
  });

  test("availability, services and field access are saved per member with an activity entry", () => {
    const availability = { ...getMemberById("samira-patel")!.availability, mode: "not-set" as const };
    let data = setAvailability(TEAM_DATA, "samira-patel", availability);
    expect(getMemberById("samira-patel", data)!.availability.mode).toBe("not-set");
    expect(getMemberById("samira-patel", data)!.activity[0]).toMatchObject({ category: "availability", detail: "Availability not set" });

    data = setServiceEligibility(data, "samira-patel", "selected", ["ac-repair-diagnostics"]);
    expect(getAssignedServiceIds(getMemberById("samira-patel", data)!, ACTIVE_SERVICE_IDS)).toEqual(["ac-repair-diagnostics"]);
    expect(getMemberById("samira-patel", data)!.activity[0].category).toBe("services");

    data = setFieldAssignable(data, "samira-patel", false);
    expect(getAssignableMembers(data).map((item) => item.id)).toEqual(["alex-morgan", "marcus-vance"]);
    expect(setFieldAssignable(data, "samira-patel", false)).toEqual(data);
    expect(snapshot()).toBe(JSON.stringify(TEAM_DATA));
  });
});
