/**
 * Team members, roles and permissions.
 *
 * One dataset: Bookings, Schedule, Jobs and the Team module all reference members by id and look the
 * name up here; nothing copies a name. These are the only three identities used consistently across
 * the approved Stitch screens ("All technicians (3)" on the Schedule). The Team list screen also shows
 * a fourth person, a Service Coordinator, under the stale spelling of customer Elena Rodriguez's name.
 * That would put one name on a customer and a team member, so she is not a team member; more people
 * arrive through Add team member.
 *
 * Contact details are only the values the approved screens agree on. Alex Morgan has a phone number but
 * no email: Stitch shows two different addresses for Alex, so none is shown.
 *
 * Fixtures are read-only. Demo edits live in components/team/TeamProvider and reset on reload.
 */
import { formatTime } from "@/lib/dates";
import { business, businessHoursByWeekday, currentUser } from "./fixtures";
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
 * Role names and descriptions are from the Roles screen. Stitch only draws the Technician's access
 * (Jobs manage, Schedule / Customers / Services view, no Team, Payments or Settings); the other
 * levels are set from each role's approved description. They are demo configuration, not authorization.
 */
export const ROLES: readonly Role[] = [
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
  {
    id: "service-manager",
    name: "Service Manager",
    description: "Manage Services, Bookings, Schedule, Jobs and Customers without access to workspace Settings.",
    kind: "custom",
    permissions: buildPermissions("none", {
      overview: "view",
      services: "manage",
      bookings: "manage",
      schedule: "manage",
      jobs: "manage",
      customers: "manage",
      "quotes-invoices": "view",
      "maintenance-plans": "view",
      reviews: "view",
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

/** The business hours (the saved Settings hours; the baseline by default) as a weekly schedule: the starting point for a custom schedule. */
export function weeklyFromBusinessHours(businessHours: Readonly<Record<number, { open: string; close: string } | null>> = businessHoursByWeekday): WeeklyHours {
  return Object.fromEntries(
    WEEK_ORDER.map((day) => {
      const hours = businessHours[day];
      return [day, hours ? { enabled: true, start: hours.open, end: hours.close } : { enabled: false, start: "08:00", end: "17:00" }];
    }),
  );
}

function customWeek(start: string, end: string, breakStart: string, breakEnd: string): WeeklyHours {
  return Object.fromEntries(
    WEEK_ORDER.map((day) => [
      day,
      day >= 1 && day <= 5
        ? { enabled: true, start, end, breakStart, breakEnd }
        : { enabled: false, start: "08:00", end: "14:00" },
    ]),
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

const ALL_SERVICE_IDS = [
  "ac-repair-diagnostics",
  "annual-cooling-tune-up",
  "heat-pump-diagnostics-repair",
  "emergency-no-heat-no-cool",
  "ductless-mini-split-estimate",
  "furnace-safety-inspection",
] as const;

export const TEAM: readonly TeamMember[] = [
  {
    // Alex Morgan is the signed-in Operations Lead and the workspace owner.
    id: "alex-morgan",
    name: currentUser.name,
    role: currentUser.role,
    roleId: "owner",
    phone: "(512) 555-0100",
    status: "active",
    fieldAssignable: true,
    availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(), unavailable: [] },
    serviceMode: "selected",
    serviceIds: ALL_SERVICE_IDS,
    activity: [
      {
        id: "act-alex-1",
        at: "2024-10-25T10:00",
        category: "jobs",
        title: "Assigned to Job #JB-204",
        detail: "AC Repair & Diagnostics · Customer: Sarah Mitchell",
        byId: "alex-morgan",
        jobId: "JB-204",
      },
      {
        id: "act-alex-2",
        at: "2024-10-24T10:30",
        category: "jobs",
        title: "Job #JB-182 completed",
        detail: "Furnace Safety Inspection & Tune-Up · Customer: Arthur Pendleton · Completed at 10:30 AM",
        jobId: "JB-182",
      },
    ],
  },
  {
    id: "marcus-vance",
    name: "Marcus Vance",
    role: "Technician",
    roleId: "technician",
    title: "Senior HVAC Technician",
    email: "marcus.v@apexclimate.com",
    phone: "(512) 555-0144",
    status: "active",
    fieldAssignable: true,
    memberSince: "March 2023",
    notes: "Specializes in residential heat pump diagnostics, seasonal tune-ups and refrigerant leak checks.",
    availability: {
      mode: "custom",
      weekly: customWeek("08:00", "16:30", "12:00", "12:30"),
      unavailable: [
        { id: "off-mv-1", title: "Annual Vacation", reason: "Time off", startDate: "2024-10-14", endDate: "2024-10-18" },
        {
          id: "off-mv-2",
          title: "Advanced Heat Pump Diagnostics Seminar",
          reason: "Mandatory training",
          startDate: "2024-11-05",
          endDate: "2024-11-05",
          startTime: "08:00",
          endTime: "13:00",
        },
      ],
    },
    serviceMode: "selected",
    serviceIds: ALL_SERVICE_IDS,
    activity: [
      {
        id: "act-mv-1",
        at: "2024-10-25T10:02",
        category: "jobs",
        title: "Assigned to Job #JB-201",
        detail: "Heat Pump Diagnostics & Repair · Customer: David Chen",
        byId: "alex-morgan",
        jobId: "JB-201",
      },
      {
        id: "act-mv-2",
        at: "2024-10-25T09:30",
        category: "jobs",
        title: "Job #JB-186 completed",
        detail: "AC Repair & Diagnostics · Customer: Robert Ramirez · Completed at 9:30 AM",
        jobId: "JB-186",
      },
      {
        id: "act-mv-3",
        at: "2024-10-25T09:00",
        category: "services",
        title: "Assigned services updated",
        detail: "Added ‘Heat Pump Diagnostics & Repair’ to eligible services",
        byId: "alex-morgan",
      },
      {
        id: "act-mv-4",
        at: "2024-10-24T09:00",
        category: "availability",
        title: "Working hours updated",
        detail: "Thursday shift adjusted from 8:00 AM – 4:00 PM to 8:00 AM – 4:30 PM",
        byId: "alex-morgan",
      },
      {
        id: "act-mv-5",
        at: "2024-10-24T09:00",
        category: "availability",
        title: "Unavailable period scheduled",
        detail: "Annual Vacation: Oct 14 – Oct 18, 2024 added",
        byId: "alex-morgan",
      },
      {
        id: "act-mv-6",
        at: "2024-10-05T09:00",
        category: "access",
        title: "Permissions updated",
        detail: "Inheriting updated Technician role defaults",
        byId: "alex-morgan",
      },
      {
        id: "act-mv-7",
        at: "2023-03-14T11:15",
        category: "access",
        title: "Invitation accepted & joined workspace",
        detail: "Joined as Technician with Field access enabled",
      },
      {
        id: "act-mv-8",
        at: "2023-03-14T09:30",
        category: "access",
        title: "Invitation sent",
        detail: "Invited by Alex Morgan to Climvia Workspace as Technician",
        byId: "alex-morgan",
      },
    ],
  },
  {
    id: "samira-patel",
    name: "Samira Patel",
    role: "Technician",
    roleId: "technician",
    title: "Apprentice Technician",
    email: "samira.hvac@gmail.com",
    phone: "(512) 555-0199",
    status: "active",
    fieldAssignable: true,
    availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(), unavailable: [] },
    serviceMode: "selected",
    serviceIds: ALL_SERVICE_IDS,
    activity: [
      {
        id: "act-sp-1",
        at: "2024-10-25T10:05",
        category: "jobs",
        title: "Assigned to Job #JB-195",
        detail: "Annual Cooling Tune-Up & Maintenance · Customer: Bradley Cooper",
        byId: "alex-morgan",
        jobId: "JB-195",
      },
      {
        id: "act-sp-2",
        at: "2024-10-24T17:45",
        category: "jobs",
        title: "Job #JB-184 completed",
        detail: "Emergency No-Heat / No-Cool Service · Customer: Liam Foster · Completed at 5:45 PM",
        jobId: "JB-184",
      },
    ],
  },
];

/* ───────────────────────── team data (fixtures or session copy) ───────────────────────── */

export type TeamData = { members: readonly TeamMember[]; roles: readonly Role[] };

export const TEAM_DATA: TeamData = { members: TEAM, roles: ROLES };


export function getTeamMemberById(id: string | undefined): TeamMember | undefined {
  return id ? TEAM.find((member) => member.id === id) : undefined;
}

/** Like getTeamMemberById but reads a (session) copy, so it also finds members added this session. */
export function getMemberById(id: string, data: TeamData = TEAM_DATA): TeamMember | undefined {
  return data.members.find((member) => member.id === id);
}

export function getRoleById(id: string | undefined, data: TeamData = TEAM_DATA): Role | undefined {
  return id ? data.roles.find((role) => role.id === id) : undefined;
}

/** People currently using a role (deactivated members no longer count). */
export function getMembersForRole(roleId: string, data: TeamData = TEAM_DATA): TeamMember[] {
  return data.members.filter((member) => member.roleId === roleId && member.status !== "inactive");
}

/** Members who can be given new work: active and field-assignable. */
export function getAssignableMembers(data: TeamData = TEAM_DATA): TeamMember[] {
  return data.members.filter((member) => member.status === "active" && member.fieldAssignable);
}

export function getEffectivePermissions(member: TeamMember, data: TeamData = TEAM_DATA): Permissions {
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
  /** The business hours as shown in Settings ("Mon–Fri", "7:30 AM–6:00 PM"); the baseline rows by default. */
  hoursRows: readonly { days: string; hours: string }[] = business.hours,
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
