/**
 * Team members, roles and permissions: the types, the product's system roles and the pure helpers.
 *
 * The records themselves live in PostgreSQL (team_members, team_roles …), per organization, and reach the browser through
 * the workspace snapshot. Bookings, Schedule, Jobs and the Team module all reference members by id (the member's slug)
 * and look the name up in the directory; nothing copies a name. The canonical Apex Climate team is seed data
 * (scripts/db/seed-data/team.ts) and ships to no browser.
 *
 * A team member is a worker of the business. It is NOT an organization membership (who may sign in): see
 * src/db/schema/team.ts. Roles and permissions here are product configuration shown on screen, not authorization.
 */
import { formatTime } from "@/lib/dates";
import { WEEKDAY_NAMES, WEEK_ORDER } from "./settings";

/* ───────────────────────── permissions ───────────────────────── */

export type PermissionLevel = "none" | "view" | "manage";
export const PERMISSION_LEVELS: readonly { id: PermissionLevel; label: string }[] = [
  { id: "none", label: "No access" },
  { id: "view", label: "View" },
  { id: "manage", label: "Manage" },
];

/** The 16 workspace modules, grouped as on the approved role screens. */
export const PERMISSION_GROUPS = [
  { id: "operations", label: "Operations", modules: ["overview", "bookings", "schedule", "jobs", "customers"] },
  { id: "business", label: "Business", modules: ["services", "team", "quotes-invoices", "payments", "maintenance-plans"] },
  { id: "growth", label: "Growth", modules: ["website", "marketplace", "reviews", "marketing"] },
  { id: "insights-settings", label: "Insights & Settings", modules: ["analytics", "settings"] },
] as const;

export type ModuleId = (typeof PERMISSION_GROUPS)[number]["modules"][number];
export const MODULE_IDS: readonly ModuleId[] = PERMISSION_GROUPS.flatMap((group) => group.modules);

export const MODULE_INFO: Record<ModuleId, { label: string; description: string }> = {
  overview: { label: "Overview", description: "View workspace overview and daily status." },
  bookings: { label: "Bookings", description: "View and manage customer bookings." },
  schedule: { label: "Schedule", description: "View and manage schedule timeline." },
  jobs: { label: "Jobs", description: "View and manage Job records." },
  customers: { label: "Customers", description: "Access customer and property records." },
  services: { label: "Services", description: "View and configure services in the catalog." },
  team: { label: "Team", description: "Manage team member directory and permissions." },
  "quotes-invoices": { label: "Quotes & Invoices", description: "Create and view customer quotes and invoices." },
  payments: { label: "Payments", description: "View and manage customer payment records." },
  "maintenance-plans": { label: "Maintenance Plans", description: "View and manage recurring service agreements." },
  website: { label: "Website", description: "Manage online booking website." },
  marketplace: { label: "Marketplace", description: "Manage directory listing." },
  reviews: { label: "Reviews", description: "View customer reviews." },
  marketing: { label: "Marketing", description: "Manage customer reminders." },
  analytics: { label: "Analytics", description: "View workspace reports." },
  settings: { label: "Settings", description: "Manage company settings and integrations." },
};

export type Permissions = Readonly<Record<ModuleId, PermissionLevel>>;

/** Build a full permission set: every module starts at `base`, then `levels` overrides. */
export function buildPermissions(base: PermissionLevel, levels: Partial<Record<ModuleId, PermissionLevel>> = {}): Permissions {
  return Object.fromEntries(MODULE_IDS.map((id) => [id, levels[id] ?? base])) as Permissions;
}

/* ───────────────────────── roles ───────────────────────── */

export type Role = {
  id: string;
  name: string;
  description: string;
  kind: "system" | "custom";
  /** The Owner role cannot be edited. */
  protected?: boolean;
  permissions: Permissions;
};

/**
 * The system roles every business starts with. Role names and descriptions are from the Roles screen. Stitch only draws
 * the Technician's access (Jobs manage, Schedule / Customers / Services view, no Team, Payments or Settings); the other
 * levels are set from each role's approved description. They are configuration, not authorization.
 */
export const SYSTEM_ROLES: readonly Role[] = [
  {
    id: "owner",
    name: "Owner",
    description: "Full workspace access.",
    kind: "system",
    protected: true,
    permissions: buildPermissions("manage"),
  },
  {
    id: "administrator",
    name: "Administrator",
    description: "Manage most workspace operations and settings.",
    kind: "system",
    permissions: buildPermissions("manage"),
  },
  {
    id: "office-scheduling",
    name: "Office & Scheduling",
    description: "Manage Bookings, Schedule, Customers and related office workflows.",
    kind: "system",
    permissions: buildPermissions("none", {
      overview: "view",
      bookings: "manage",
      schedule: "manage",
      jobs: "manage",
      customers: "manage",
      services: "view",
      "quotes-invoices": "view",
      "maintenance-plans": "view",
      reviews: "view",
    }),
  },
  {
    id: "technician",
    name: "Technician",
    description: "Manage assigned Jobs and view the Schedule, customer and Service information needed for field work.",
    kind: "system",
    permissions: buildPermissions("none", {
      overview: "view",
      bookings: "view",
      schedule: "view",
      jobs: "manage",
      customers: "view",
      services: "view",
      "quotes-invoices": "view",
      "maintenance-plans": "view",
    }),
  },
  {
    id: "apprentice",
    name: "Apprentice",
    description: "View assigned Jobs and Schedule with limited editing access.",
    kind: "system",
    permissions: buildPermissions("none", {
      overview: "view",
      schedule: "view",
      jobs: "view",
      customers: "view",
      services: "view",
    }),
  },
  {
    id: "bookkeeper",
    name: "Bookkeeper",
    description: "Manage Quotes & Invoices and customer payment records.",
    kind: "system",
    permissions: buildPermissions("none", {
      overview: "view",
      customers: "view",
      jobs: "view",
      services: "view",
      "quotes-invoices": "manage",
      payments: "manage",
      "maintenance-plans": "view",
    }),
  },
];

/** Roles whose members work in the field. Anyone else with job access is "Both" (e.g. the owner). */
const FIELD_ROLE_IDS: readonly string[] = ["technician", "apprentice"];

/* ───────────────────────── availability ───────────────────────── */

export type DayHours = { enabled: boolean; start: string; end: string; breakStart?: string; breakEnd?: string };
/** Keyed by weekday index, 0 = Sunday. */
export type WeeklyHours = Readonly<Record<number, DayHours>>;

export type UnavailablePeriod = {
  id: string;
  title: string;
  reason: string;
  /** "2024-10-14" */
  startDate: string;
  endDate: string;
  /** Set for part-day periods, e.g. a morning of training. */
  startTime?: string;
  endTime?: string;
};

export type AvailabilityMode = "business-hours" | "custom" | "not-set";

export type Availability = {
  mode: AvailabilityMode;
  /** Used when mode is "custom". */
  weekly: WeeklyHours;
  unavailable: readonly UnavailablePeriod[];
};

// The days of the week are Settings'; Team lists them in the same order (Monday first, as the approved screen does).
export { WEEKDAY_NAMES, WEEK_ORDER } from "./settings";

/** The business hours (the saved Settings hours) as a weekly schedule: the starting point for a custom schedule. */
export function weeklyFromBusinessHours(businessHours: Readonly<Record<number, { open: string; close: string } | null>>): WeeklyHours {
  return Object.fromEntries(
    WEEK_ORDER.map((day) => {
      const hours = businessHours[day];
      return [day, hours ? { enabled: true, start: hours.open, end: hours.close } : { enabled: false, start: "08:00", end: "17:00" }];
    }),
  );
}

/* ───────────────────────── members ───────────────────────── */

export type MemberStatus = "active" | "invited" | "inactive";

export type ActivityCategory = "access" | "availability" | "jobs" | "services";
export const ACTIVITY_CATEGORIES: readonly { id: ActivityCategory; label: string }[] = [
  { id: "access", label: "Access & Roles" },
  { id: "availability", label: "Availability" },
  { id: "jobs", label: "Jobs" },
  { id: "services", label: "Services" },
];

export type ActivityEntry = {
  id: string;
  /** "2024-10-25T10:02", business-local */
  at: string;
  category: ActivityCategory;
  title: string;
  detail?: string;
  /** Team member who made the change. */
  byId?: string;
  jobId?: string;
};

export type TeamMember = {
  id: string;
  name: string;
  /** Job title shown across Schedule, Jobs and Bookings ("Operations Lead", "Technician"). */
  role: string;
  /** Access role (the Roles screen). Permissions come from it unless `permissionOverride` is set. */
  roleId: string;
  /** A longer title where the Team list shows one under the name. */
  title?: string;
  email?: string;
  phone?: string;
  status: MemberStatus;
  /** Can be assigned to Jobs and appears on the Schedule. */
  fieldAssignable: boolean;
  /** "March 2023", only where an approved screen gives it. */
  memberSince?: string;
  notes?: string;
  availability: Availability;
  /** "all" = every active catalog service, now and later. "selected" = only `serviceIds`. */
  serviceMode: "all" | "selected";
  serviceIds: readonly string[];
  /** Member-specific permissions; undefined = inherit the role. */
  permissionOverride?: Permissions;
  activity: readonly ActivityEntry[];
};

/* ───────────────────────── team data (the workspace's team, read from the database) ───────────────────────── */

export type TeamData = { members: readonly TeamMember[]; roles: readonly Role[] };

export const EMPTY_TEAM: TeamData = { members: [], roles: [] };

export function getTeamMemberById(id: string | undefined, data: TeamData): TeamMember | undefined {
  return id ? data.members.find((member) => member.id === id) : undefined;
}

export function getMemberById(id: string, data: TeamData): TeamMember | undefined {
  return data.members.find((member) => member.id === id);
}

export function getRoleById(id: string | undefined, data: TeamData): Role | undefined {
  return id ? data.roles.find((role) => role.id === id) : undefined;
}

/** People currently using a role (deactivated members no longer count). */
export function getMembersForRole(roleId: string, data: TeamData): TeamMember[] {
  return data.members.filter((member) => member.roleId === roleId && member.status !== "inactive");
}

/** Members who can be given new work: active and field-assignable. */
export function getAssignableMembers(data: TeamData): TeamMember[] {
  return data.members.filter((member) => member.status === "active" && member.fieldAssignable);
}

export function getEffectivePermissions(member: TeamMember, data: TeamData): Permissions {
  return member.permissionOverride ?? getRoleById(member.roleId, data)?.permissions ?? buildPermissions("none");
}

export type Classification = "field" | "office" | "both";
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  field: "Field",
  office: "Office / admin",
  both: "Both (Owner & Field)",
};

export function getClassification(member: TeamMember): Classification {
  if (!member.fieldAssignable) return "office";
  return FIELD_ROLE_IDS.includes(member.roleId) ? "field" : "both";
}

/** Services this member can be assigned to, given the ids of the active catalog services. */
export function getAssignedServiceIds(member: TeamMember, activeServiceIds: readonly string[]): string[] {
  return member.serviceMode === "all" ? [...activeServiceIds] : member.serviceIds.filter((id) => activeServiceIds.includes(id));
}

/** The number of modules a permission set lets someone open. */
export function countAccessibleModules(perms: Permissions): number {
  return MODULE_IDS.filter((id) => perms[id] !== "none").length;
}

/** The two-line availability summary used in the Team list and on a member's Overview. */
export function describeAvailability(
  availability: Availability,
  /** The business hours as shown in Settings ("Mon–Fri", "7:30 AM–6:00 PM"). */
  hoursRows: readonly { days: string; hours: string }[],
): { title: string; detail: string } {
  if (availability.mode === "business-hours") {
    const open = hoursRows.filter((row) => row.hours !== "Closed");
    return { title: "Uses business hours", detail: open.map((row) => `${row.days} ${row.hours}`).join(" · ") };
  }
  if (availability.mode === "custom") {
    return { title: "Custom schedule", detail: summarizeWeek(availability.weekly, formatTime) };
  }
  return { title: "Not set", detail: "Pending setup" };
}

/** "Mon–Fri, 8:00 AM – 4:30 PM"; the caller supplies the time formatter. */
export function summarizeWeek(weekly: WeeklyHours, formatTime: (time: string) => string): string {
  const days = WEEK_ORDER.filter((day) => weekly[day]?.enabled);
  if (days.length === 0) return "No working days";
  const first = weekly[days[0]];
  const same = days.every((day) => weekly[day].start === first.start && weekly[day].end === first.end);
  const names = days.map((day) => WEEKDAY_NAMES[day].slice(0, 3));
  const positions = days.map((day) => WEEK_ORDER.indexOf(day));
  const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  const range = days.length === 1 ? names[0] : contiguous ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
  return same ? `${range}, ${formatTime(first.start)} – ${formatTime(first.end)}` : `${range}, hours vary by day`;
}
