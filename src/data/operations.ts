/**
 * Operational records: Bookings, Jobs and Schedule blocks.
 *
 * One dataset feeds Bookings, Schedule and Jobs. A booking and its job reference the Customers,
 * Properties, Services and Team fixtures by id; the Schedule has no events of its own, it is derived
 * from bookings and jobs (plus a few internal blocks). Nothing here repeats a customer, service or
 * technician name: those are looked up.
 *
 * Resolved from design-reference/stitch (bookings_refined, create_booking_flow, schedule_*,
 * jobs_active_list, job_jb_204_*). Stitch contradicts itself heavily here; every decision is listed
 * in docs/stitch-screen-map.md §8. In short:
 *  - "Today" is Friday, Oct 25, 2024 (the Schedule's "TODAY" badge, Jobs and Customers screens).
 *  - Dates and times are business-local (Austin) wall-clock values; no timezone conversion exists.
 *  - Statuses are the locked sets: bookings (pending, confirmed, completed, cancelled) and jobs
 *    (scheduled, in-progress, completed). Stitch's "En route", "Waiting – parts", "Needs assignment"
 *    and "Needs customer response" are not statuses here; "needs assignment" is simply "no assignee".
 *  - People without a Customers record (requesters and one-off visits that appear in Stitch) are
 *    carried as a snapshot `contactName` only. No contact details or addresses are invented for them.
 *
 * Fixtures are read-only. Demo edits live in components/operations/OperationsProvider and reset on reload.
 */
import { getCustomerById } from "./customers";
import { getServiceById } from "./services";
import { getTeamMemberById } from "./team";

/* ───────────────────────── types ───────────────────────── */

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type JobStatus = "scheduled" | "in-progress" | "completed";

export const BOOKING_SOURCES = [
  "Website",
  "Booking link",
  "Marketplace",
  "Maintenance plan",
  "Phone / Front desk",
  "Email",
  "Walk-in",
  "Other",
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/** Sources a staff member can pick when entering a booking by hand. */
export const OFFLINE_BOOKING_SOURCES: readonly BookingSource[] = ["Phone / Front desk", "Email", "Walk-in", "Other"];

export type BookingIntake = {
  systemType?: string;
  equipment?: string;
  reportedIssue?: string;
};

/**
 * Booking numbers held for one maintenance plan visit, keyed by the visit's id. Sarah Mitchell's included cooling
 * visit is #BK-1048: it gets that number whenever it is scheduled, and no other booking is given it first.
 */
export const RESERVED_BOOKING_NUMBERS: Readonly<Record<string, number>> = { "plan-sarah-comfort-care-v2": 1048 };

export type Booking = {
  /** "BK-1042" */
  id: string;
  /** Exactly one of customerId / contactName is set. */
  customerId?: string;
  /** Snapshot for a requester who has no Customers record yet. */
  contactName?: string;
  propertyId?: string;
  serviceId: string;
  /** "2024-10-25", business-local */
  date: string;
  /** "10:00", business-local */
  start: string;
  end: string;
  status: BookingStatus;
  assigneeId?: string;
  source?: BookingSource;
  /** "2024-10-24T09:42", business-local */
  receivedAt?: string;
  confirmedAt?: string;
  /** Short customer note shown under the service in the list. */
  note?: string;
  intake?: BookingIntake;
  internalNotes?: string;
  jobId?: string;
  cancellation?: { reason: string };
  /** Contact details for someone without a Customers record, e.g. a request made on the website. */
  contact?: { phone?: string; email?: string; address?: string };
  /** The maintenance plan visit this booking schedules. The plan holds the matching booking id. */
  planVisit?: { planId: string; visitId: string };
};

export type FileCategory = "Before work" | "Diagnostic / Meter" | "Equipment serial" | "After completion";
export const FILE_CATEGORIES: readonly FileCategory[] = [
  "Before work",
  "Diagnostic / Meter",
  "Equipment serial",
  "After completion",
];

export type JobFile = {
  id: string;
  name: string;
  /** Size in KB, shown as MB when large. */
  sizeKb: number;
  category?: FileCategory;
  caption?: string;
  /** "10:24", business-local time the photo was taken. */
  takenAt?: string;
  visibility: "customer" | "internal";
  /** A short label burned into the thumbnail in Stitch (e.g. "Carrier · SN: 1618E42109"). */
  badge?: string;
};

export type ChecklistItem = { label: string; note?: string; passed: boolean };

export type JobDetails = {
  technicianDiagnosis?: string;
  workPerformed?: string;
  /** Shown to the customer on the completion report. */
  customerSummary?: string;
  /** Private to the team. */
  internalNotes?: string;
  checklist?: readonly ChecklistItem[];
  customerRequest?: string;
  safetyNote?: string;
};

export type Job = {
  /** "JB-204" */
  id: string;
  bookingId?: string;
  customerId?: string;
  contactName?: string;
  propertyId?: string;
  serviceId: string;
  assigneeId?: string;
  date: string;
  start: string;
  end: string;
  status: JobStatus;
  /** Short description of the work, for jobs that don't need the longer details. */
  workSummary?: string;
  /** Equipment worked on; references data/customers EQUIPMENT. */
  equipmentId?: string;
  note?: string;
  details: JobDetails;
  files: readonly JobFile[];
  completion?: { notes: string; at: string };
};

export type ScheduleBlock = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  /** Team members the block applies to. */
  memberIds: readonly string[];
};

export type OperationsData = {
  bookings: readonly Booking[];
  jobs: readonly Job[];
  blocks: readonly ScheduleBlock[];
};

/* ───────────────────────── fixtures ───────────────────────── */

export const BOOKINGS: readonly Booking[] = [
  // ── Requests awaiting confirmation
  {
    id: "BK-1040",
    contactName: "Claire Dubois",
    serviceId: "heat-pump-diagnostics-repair",
    date: "2024-10-28",
    start: "09:00",
    end: "11:00",
    status: "pending",
    source: "Marketplace",
    receivedAt: "2024-10-24T06:10",
    note: "Dual-fuel hybrid inquiry",
  },
  {
    id: "BK-1038",
    contactName: "Jason Miller",
    serviceId: "ductless-mini-split-estimate",
    date: "2024-10-26",
    start: "09:00",
    end: "11:00",
    status: "pending",
    source: "Website",
    receivedAt: "2024-10-23T16:30",
    note: "Garage workshop add-on",
  },

  // ── Confirmed, upcoming
  // BK-1042 / JB-204 is Completed (Phase 7 reconciliation: Sarah's last service is JB-204 and it is invoiced and paid).
  {
    id: "BK-1042",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "ac-repair-diagnostics",
    date: "2024-10-25",
    start: "10:00",
    end: "12:00",
    status: "completed",
    assigneeId: "alex-morgan",
    source: "Website",
    receivedAt: "2024-10-24T09:42",
    confirmedAt: "2024-10-24T15:15",
    intake: {
      systemType: "Central Heat Pump",
      equipment: "Carrier (~8 years old)",
      reportedIssue:
        "Indoor unit blowing warm air since yesterday afternoon. Thermostat set to 72° but room reads 79°. Outdoor condenser fan seems to spin slowly with humming sound.",
    },
    jobId: "JB-204",
  },
  {
    id: "BK-1041",
    contactName: "Robert Ramirez",
    serviceId: "furnace-safety-inspection",
    date: "2024-10-28",
    start: "14:00",
    end: "16:00",
    status: "confirmed",
    source: "Booking link",
    receivedAt: "2024-10-24T08:10",
    confirmedAt: "2024-10-24T08:10",
    note: "Pre-winter inspection",
  },
  {
    id: "BK-1039",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    serviceId: "heat-pump-diagnostics-repair",
    date: "2024-10-25",
    start: "13:30",
    end: "15:30",
    status: "confirmed",
    assigneeId: "marcus-vance",
    jobId: "JB-201",
  },
  {
    id: "BK-1035",
    customerId: "elena-rodriguez",
    propertyId: "prop-elena-condo",
    serviceId: "ac-repair-diagnostics",
    date: "2024-10-25",
    start: "15:00",
    end: "17:00",
    status: "confirmed",
    note: "Customer flexible ±1 hr",
    jobId: "JB-198",
  },
  {
    id: "BK-1028",
    customerId: "bradley-cooper",
    propertyId: "prop-bradley-bungalow",
    serviceId: "annual-cooling-tune-up",
    date: "2024-10-26",
    start: "09:00",
    end: "10:00",
    status: "confirmed",
    assigneeId: "samira-patel",
    jobId: "JB-195",
  },
  {
    id: "BK-1014",
    customerId: "hannah-wright",
    propertyId: "prop-hannah-residence",
    serviceId: "ac-repair-diagnostics",
    date: "2024-10-26",
    start: "14:00",
    end: "16:00",
    status: "confirmed",
    assigneeId: "alex-morgan",
    jobId: "JB-189",
  },

  // ── Completed this week
  {
    id: "BK-1006",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    serviceId: "furnace-safety-inspection",
    date: "2024-10-21",
    start: "08:00",
    end: "10:00",
    status: "completed",
    assigneeId: "alex-morgan",
    jobId: "JB-178",
  },
  {
    id: "BK-1007",
    contactName: "Olivia Romero",
    serviceId: "ac-repair-diagnostics",
    date: "2024-10-23",
    start: "09:00",
    end: "11:00",
    status: "completed",
    assigneeId: "alex-morgan",
    jobId: "JB-180",
  },
  {
    id: "BK-1008",
    contactName: "Arthur Pendleton",
    serviceId: "furnace-safety-inspection",
    date: "2024-10-24",
    start: "08:30",
    end: "10:30",
    status: "completed",
    assigneeId: "alex-morgan",
    jobId: "JB-182",
  },
  {
    id: "BK-1009",
    contactName: "Liam Foster",
    serviceId: "emergency-no-heat-no-cool",
    date: "2024-10-24",
    start: "15:45",
    end: "17:45",
    status: "completed",
    assigneeId: "samira-patel",
    jobId: "JB-184",
  },
  {
    id: "BK-1010",
    contactName: "Robert Ramirez",
    serviceId: "ac-repair-diagnostics",
    date: "2024-10-25",
    start: "08:00",
    end: "09:30",
    status: "completed",
    assigneeId: "marcus-vance",
    jobId: "JB-186",
  },
];

const EMPTY_DETAILS: JobDetails = {};

export const JOBS: readonly Job[] = [
  {
    id: "JB-204",
    bookingId: "BK-1042",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "ac-repair-diagnostics",
    assigneeId: "alex-morgan",
    date: "2024-10-25",
    start: "10:00",
    end: "12:00",
    status: "completed",
    equipmentId: "eq-sarah-heat-pump",
    completion: {
      notes:
        "Replaced worn dual run capacitor that was preventing outdoor cooling compressor from starting. System is now operating with normal cooling performance and an 18.2°F temperature drop across air handler.",
      at: "2024-10-25T10:45",
    },
    details: {
      technicianDiagnosis:
        "Dual capacitor failure on compressor/herm circuit (rated 45µF, tested at 11.2µF, 75% out of spec). Compressor attempting to start with elevated locked rotor amps (LRA 58A) causing thermal limit tripping. Condenser coil has light dust accumulation; contactor contacts showing minor pitting but viable.",
      workPerformed: [
        "- Isolated high-voltage disconnect switch and verified zero potential at breaker.",
        "- Discharged and safely removed defective 45/5 µF capacitor.",
        "- Installed brand new Titan HD 45/5 µF 440V dual run capacitor with new spade terminal crimps.",
        "- Powered system up and verified compressor starting amp draw dropped to 9.4A (well below 14.2A RLA rating).",
        "- Checked delta-T split across evaporator: 18.2°F drop (return air 76.5°F, supply air 58.3°F), normal operating range.",
        "- Rinsed outdoor condenser coil with low pressure water.",
      ].join("\n"),
      customerSummary:
        "Replaced worn dual run capacitor that was preventing outdoor cooling compressor from starting. System is now operating with normal cooling performance and an 18.2°F temperature drop across air handler. Recommend scheduling standard pre-summer maintenance in May 2025.",
      internalNotes:
        "Contactor points have about 1-2 seasons remaining before needing replacement. Mention contactor replacement on next tune-up visit.",
      customerRequest: "Customer requests shoe covers worn at all times inside the house.",
      safetyNote: "Watch ladder clearance in hallway (ceiling hatch opens against linen closet door).",
      checklist: [
        { label: "Safety disconnect test & ground check", note: "Verified 0V L1/L2 prior to service", passed: true },
        { label: "Discharged dual run capacitor", note: "Bleed resistor wand confirmed safe", passed: true },
        { label: "Compressor start amp draw (RLA)", note: "Recorded: 9.4 Amps", passed: true },
        { label: "Fan motor amp draw", note: "Recorded: 1.1 Amps", passed: true },
        { label: "Temperature split (return vs supply)", note: "Recorded: 18.2°F drop", passed: true },
        { label: "Refrigerant suction & subcooling", note: "118 psig / 10.2°F subcool", passed: true },
        { label: "Thermostat cycle & cooling call test", note: "Thermostat calls Y1/G reliably", passed: true },
        { label: "Wash condenser coil fins", note: "Debris cleared with low-pressure rinse", passed: true },
      ],
    },
    files: [
      {
        id: "file-204-1",
        name: "IMG_4821.jpg",
        sizeKb: 2458,
        category: "Diagnostic / Meter",
        caption: "Defective run capacitor testing 11.2 µF on 45 µF rating (75% below tolerance).",
        takenAt: "10:24",
        visibility: "customer",
        badge: "11.2 µF / 45.0 µF (-75%)",
      },
      {
        id: "file-204-2",
        name: "IMG_4819.jpg",
        sizeKb: 3174,
        category: "Equipment serial",
        caption: "Outdoor unit rating plate with verified serial number and factory R-410A charge specs.",
        takenAt: "10:15",
        visibility: "internal",
        badge: "Carrier · SN: 1618E42109",
      },
      {
        id: "file-204-3",
        name: "IMG_4820.jpg",
        sizeKb: 2867,
        category: "Before work",
        caption:
          "Control compartment before component replacement. Showing original factory wiring, swollen capacitor casing, and early contactor pitting prior to disassembly.",
        takenAt: "10:18",
        visibility: "customer",
        badge: "Pre-service condition",
      },
      {
        id: "file-204-4",
        name: "IMG_4825.jpg",
        sizeKb: 2662,
        category: "After completion",
        caption:
          "New Titan HD 45/5 µF run capacitor installed, wired, and tested under full compressor load. Securely clamped in galvanized housing bracket with high-temp insulator boots. System restarted and drawn amperage checked normal (9.8A).",
        takenAt: "10:44",
        visibility: "customer",
        badge: "Titan HD 45/5 µF · Passed 44.9 µF",
      },
    ],
  },
  {
    id: "JB-201",
    bookingId: "BK-1039",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    serviceId: "heat-pump-diagnostics-repair",
    assigneeId: "marcus-vance",
    date: "2024-10-25",
    start: "13:30",
    end: "15:30",
    status: "scheduled",
    workSummary: "Heat Pump Reversing Valve",
    details: EMPTY_DETAILS,
    files: [],
  },
  {
    id: "JB-198",
    bookingId: "BK-1035",
    customerId: "elena-rodriguez",
    propertyId: "prop-elena-condo",
    serviceId: "ac-repair-diagnostics",
    date: "2024-10-25",
    start: "15:00",
    end: "17:00",
    status: "scheduled",
    workSummary: "Dual Capacitor Replacement",
    note: "Customer flexible ±1 hr",
    details: EMPTY_DETAILS,
    files: [],
  },
  {
    id: "JB-195",
    bookingId: "BK-1028",
    customerId: "bradley-cooper",
    propertyId: "prop-bradley-bungalow",
    serviceId: "annual-cooling-tune-up",
    assigneeId: "samira-patel",
    date: "2024-10-26",
    start: "09:00",
    end: "10:00",
    status: "scheduled",
    workSummary: "Mini-Split Line Flush",
    details: EMPTY_DETAILS,
    files: [],
  },
  {
    id: "JB-189",
    bookingId: "BK-1014",
    customerId: "hannah-wright",
    propertyId: "prop-hannah-residence",
    serviceId: "ac-repair-diagnostics",
    assigneeId: "alex-morgan",
    date: "2024-10-26",
    start: "14:00",
    end: "16:00",
    status: "scheduled",
    workSummary: "Sensor Fault Follow-up",
    details: EMPTY_DETAILS,
    files: [],
  },

  // ── Completed
  {
    id: "JB-186",
    bookingId: "BK-1010",
    contactName: "Robert Ramirez",
    serviceId: "ac-repair-diagnostics",
    assigneeId: "marcus-vance",
    date: "2024-10-25",
    start: "08:00",
    end: "09:30",
    status: "completed",
    workSummary: "Dual Capacitor Check",
    details: EMPTY_DETAILS,
    files: [],
    completion: { notes: "Capacitor checked; system operating normally.", at: "2024-10-25T09:30" },
  },
  {
    id: "JB-184",
    bookingId: "BK-1009",
    contactName: "Liam Foster",
    serviceId: "emergency-no-heat-no-cool",
    assigneeId: "samira-patel",
    date: "2024-10-24",
    start: "15:45",
    end: "17:45",
    status: "completed",
    workSummary: "Emergency Heat Check",
    details: EMPTY_DETAILS,
    files: [],
    completion: { notes: "Heating restored.", at: "2024-10-24T17:45" },
  },
  {
    id: "JB-182",
    bookingId: "BK-1008",
    contactName: "Arthur Pendleton",
    serviceId: "furnace-safety-inspection",
    assigneeId: "alex-morgan",
    date: "2024-10-24",
    start: "08:30",
    end: "10:30",
    status: "completed",
    workSummary: "Gas Furnace Safety Check",
    details: EMPTY_DETAILS,
    files: [],
    completion: { notes: "Inspection complete; no issues found.", at: "2024-10-24T10:30" },
  },
  {
    id: "JB-180",
    bookingId: "BK-1007",
    contactName: "Olivia Romero",
    serviceId: "ac-repair-diagnostics",
    assigneeId: "alex-morgan",
    date: "2024-10-23",
    start: "09:00",
    end: "11:00",
    status: "completed",
    workSummary: "Blower Motor Check",
    details: EMPTY_DETAILS,
    files: [],
    completion: { notes: "Blower motor checked and cleared.", at: "2024-10-23T11:00" },
  },
  {
    id: "JB-178",
    bookingId: "BK-1006",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    serviceId: "furnace-safety-inspection",
    assigneeId: "alex-morgan",
    date: "2024-10-21",
    start: "08:00",
    end: "10:00",
    status: "completed",
    workSummary: "Furnace Inspection",
    details: EMPTY_DETAILS,
    files: [],
    completion: { notes: "Inspection complete.", at: "2024-10-21T10:00" },
  },
  {
    // Historical visit from Sarah's service history (Customers). Not tied to a booking.
    id: "JB-142",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "annual-cooling-tune-up",
    assigneeId: "marcus-vance",
    date: "2024-05-14",
    start: "09:00",
    end: "10:00",
    status: "completed",
    equipmentId: "eq-sarah-thermostat",
    details: EMPTY_DETAILS,
    files: [],
    completion: { notes: "Annual tune-up complete.", at: "2024-05-14T10:00" },
  },
];

export const SCHEDULE_BLOCKS: readonly ScheduleBlock[] = [
  {
    id: "BLK-1",
    date: "2024-10-22",
    start: "08:00",
    end: "10:30",
    title: "Team Safety Training",
    memberIds: ["alex-morgan", "marcus-vance", "samira-patel"],
  },
  {
    id: "BLK-2",
    date: "2024-10-25",
    start: "08:00",
    end: "11:00",
    title: "Training / Off duty",
    memberIds: ["samira-patel"],
  },
];

export const OPERATIONS: OperationsData = { bookings: BOOKINGS, jobs: JOBS, blocks: SCHEDULE_BLOCKS };

/* ───────────────────────── selectors ─────────────────────────
 * Each takes optional data so the in-memory demo state can reuse the same logic. With no
 * argument they read the canonical fixtures. */


export function getBookingById(id: string, data: OperationsData = OPERATIONS): Booking | undefined {
  return data.bookings.find((booking) => booking.id === id);
}

export function getBookingsForCustomer(customerId: string, data: OperationsData = OPERATIONS): Booking[] {
  return data.bookings.filter((booking) => booking.customerId === customerId);
}


export function getJobById(id: string, data: OperationsData = OPERATIONS): Job | undefined {
  return data.jobs.find((job) => job.id === id);
}

/** Newest first. */
export function getJobsForCustomer(customerId: string, data: OperationsData = OPERATIONS): Job[] {
  return data.jobs
    .filter((job) => job.customerId === customerId)
    .sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`));
}

/** The party on a booking or job: a Customers record, or the snapshot name for someone without one. */
export function getPartyName(record: Pick<Booking, "customerId" | "contactName">): string {
  return (record.customerId && getCustomerById(record.customerId)?.name) || record.contactName || "Unknown customer";
}

export function getAssigneeName(record: { assigneeId?: string }): string | undefined {
  return getTeamMemberById(record.assigneeId)?.name;
}

export function getServiceNameFor(record: { serviceId: string }): string {
  return getServiceById(record.serviceId)?.name ?? "Unknown service";
}

/* ───────────────────────── schedule (derived) ───────────────────────── */

export type ScheduleEventStatus = "confirmed" | JobStatus;

export type WorkEvent = {
  kind: "work";
  /** Job id when a job exists, otherwise the booking id. */
  id: string;
  bookingId?: string;
  jobId?: string;
  customerId?: string;
  contactName?: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  assigneeId?: string;
  status: ScheduleEventStatus;
};

export type BlockEvent = {
  kind: "block";
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  memberIds: readonly string[];
};

export type ScheduleEvent = WorkEvent | BlockEvent;

/**
 * Everything on the calendar, derived from the records. A job is the event when one exists;
 * a confirmed or completed booking without a job is an event of its own. Pending and cancelled
 * bookings never appear. Sorted by date and start time.
 */
export function getScheduleEvents(data: OperationsData = OPERATIONS): ScheduleEvent[] {
  const jobEvents: WorkEvent[] = data.jobs.map((job) => ({
    kind: "work",
    id: job.id,
    bookingId: job.bookingId,
    jobId: job.id,
    customerId: job.customerId,
    contactName: job.contactName,
    serviceId: job.serviceId,
    date: job.date,
    start: job.start,
    end: job.end,
    assigneeId: job.assigneeId,
    status: job.status,
  }));

  const bookingEvents: WorkEvent[] = data.bookings
    .filter((booking) => (booking.status === "confirmed" || booking.status === "completed") && !booking.jobId)
    .map((booking) => ({
      kind: "work",
      id: booking.id,
      bookingId: booking.id,
      customerId: booking.customerId,
      contactName: booking.contactName,
      serviceId: booking.serviceId,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      assigneeId: booking.assigneeId,
      status: booking.status === "completed" ? "completed" : "confirmed",
    }));

  const blockEvents: BlockEvent[] = data.blocks.map((block) => ({ kind: "block", ...block }));

  return [...jobEvents, ...bookingEvents, ...blockEvents].sort((a, b) =>
    `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
  );
}

export function getScheduleEventsForDate(date: string, data: OperationsData = OPERATIONS): ScheduleEvent[] {
  return getScheduleEvents(data).filter((event) => event.date === date);
}

/** Work that has no technician yet and still has to happen (not completed). */
export function getUnassignedEvents(data: OperationsData = OPERATIONS): WorkEvent[] {
  return getScheduleEvents(data).filter(
    (event): event is WorkEvent => event.kind === "work" && !event.assigneeId && event.status !== "completed",
  );
}

/* ───────────────────────── presentation ───────────────────────── */

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  "in-progress": "In progress",
  completed: "Completed",
};

export const EVENT_STATUS_LABEL: Record<ScheduleEventStatus, string> = {
  confirmed: "Confirmed",
  ...JOB_STATUS_LABEL,
};

/** The Bookings tabs and the status each one shows. */
export const BOOKING_TABS = [
  { id: "requests", label: "Requests", status: "pending" },
  { id: "upcoming", label: "Upcoming", status: "confirmed" },
  { id: "past", label: "Past", status: "completed" },
  { id: "cancelled", label: "Cancelled", status: "cancelled" },
] as const satisfies readonly { id: string; label: string; status: BookingStatus }[];
export type BookingTabId = (typeof BOOKING_TABS)[number]["id"];

/** Photo size label: KB below 1 MB, otherwise MB. */
export function formatFileSize(sizeKb: number): string {
  return sizeKb >= 1000 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}
