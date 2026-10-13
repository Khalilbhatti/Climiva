/**
 * The canonical Apex Climate team: Alex Morgan (the owner), Marcus Vance and Samira Patel, plus the roles of the Roles screen.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file). The development seed writes it to PostgreSQL for
 * the Apex organization. These are the three identities used consistently across the approved screens ("All technicians
 * (3)" on the Schedule); the stale fourth person under the old spelling of a customer's name is not a team member.
 *
 * Contact details are only the values the approved screens agree on. Alex Morgan has a phone number but no email.
 */
import { businessHoursByWeekday, currentUser } from "./apex";
import {
  SYSTEM_ROLES,
  buildPermissions,
  weeklyFromBusinessHours,
  WEEK_ORDER,
  type Role,
  type TeamMember,
  type WeeklyHours,
} from "@/data/team";

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

/** The roles of the Roles screen: the six system roles plus Service Manager, a custom one. */
export const ROLES: readonly Role[] = [
  ...SYSTEM_ROLES,
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
    availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(businessHoursByWeekday), unavailable: [] },
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
    availability: { mode: "business-hours", weekly: weeklyFromBusinessHours(businessHoursByWeekday), unavailable: [] },
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
