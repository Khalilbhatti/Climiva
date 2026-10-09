import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { formatPropertyAddress, getCustomerById, getPropertyById } from "../src/data/customers";
import {
  BOOKING_TABS,
  getAssigneeName,
  getBookingById,
  getBookingsForCustomer,
  getJobById,
  getJobsForCustomer,
  getPartyName,
  getScheduleEvents,
  getScheduleEventsForDate,
  getServiceNameFor,
  getUnassignedEvents,
} from "../src/data/operations";
import { PROTOTYPE_NOW, PROTOTYPE_TODAY, BUSINESS_TIME_ZONE, business, businessHoursByWeekday, overviewMetrics } from "../src/data/fixtures";
import { getServiceById } from "../src/data/services";
import { getTeamMemberById } from "../src/data/team";
import { getSlotGroup } from "../src/lib/booking-slots";
import { addDays, formatLongDate, formatTime, formatTimeRange, startOfWeek, weekDates, weekdayIndex } from "../src/lib/dates";
import {
  RESERVED_BOOKING_NUMBERS,
  assignBookingError,
  assignJobError,
  assignableError,
  bookingReference,
  cancelError,
  completeJobError,
  confirmError,
  createJobError,
  detailsError,
  initialBookingStatus,
  jobReference,
  numberOf,
  parseCompletionNotes,
  parseDetailsPatch,
  parseNewBooking,
  parseReason,
  slotError,
  slugOf,
  startJobError,
} from "../src/lib/operations-rules";
import { BOOK, BOOKINGS, CUSTOMERS, DIR, JOBS, OPERATIONS, SCHEDULE_BLOCKS, SERVICES, TEAM, TEAM_DATA } from "./apex-data";

// Pure data/selector/rules tests: no browser needed.

test.describe("operational fixtures reference the shared records", () => {
  test("every booking resolves its customer or snapshot name, property, service and technician", () => {
    for (const booking of BOOKINGS) {
      const label = `${booking.id}`;
      // Exactly one of customerId / contactName.
      expect(Boolean(booking.customerId) !== Boolean(booking.contactName), `${label}: customerId xor contactName`).toBe(true);
      if (booking.customerId) expect(getCustomerById(booking.customerId, BOOK), `${label}: customer`).toBeDefined();
      if (booking.propertyId) {
        expect(getPropertyById(booking.propertyId, BOOK)?.customerId, `${label}: property belongs to the customer`).toBe(booking.customerId);
      }
      expect(getServiceById(booking.serviceId, SERVICES), `${label}: service`).toBeDefined();
      if (booking.assigneeId) expect(getTeamMemberById(booking.assigneeId, TEAM_DATA), `${label}: assignee`).toBeDefined();
      expect(booking.start < booking.end, `${label}: start before end`).toBe(true);
    }
  });

  test("every job resolves its references and agrees with its booking", () => {
    for (const job of JOBS) {
      expect(Boolean(job.customerId) !== Boolean(job.contactName), `${job.id}: customerId xor contactName`).toBe(true);
      if (job.customerId) expect(getCustomerById(job.customerId, BOOK), `${job.id}: customer`).toBeDefined();
      if (job.propertyId) expect(getPropertyById(job.propertyId, BOOK)?.customerId, `${job.id}: property`).toBe(job.customerId);
      expect(getServiceById(job.serviceId, SERVICES), `${job.id}: service`).toBeDefined();
      if (job.assigneeId) expect(getTeamMemberById(job.assigneeId, TEAM_DATA), `${job.id}: assignee`).toBeDefined();

      if (!job.bookingId) continue;
      const booking = getBookingById(job.bookingId, OPERATIONS);
      expect(booking, `${job.id}: booking`).toBeDefined();
      expect(booking!.jobId, `${job.id}: booking points back`).toBe(job.id);
      expect(
        { customerId: booking!.customerId, contactName: booking!.contactName, serviceId: booking!.serviceId, propertyId: booking!.propertyId },
        `${job.id}: same party and service as ${booking!.id}`,
      ).toEqual({ customerId: job.customerId, contactName: job.contactName, serviceId: job.serviceId, propertyId: job.propertyId });
      expect([booking!.date, booking!.start, booking!.end, booking!.assigneeId], `${job.id}: same appointment`).toEqual([
        job.date,
        job.start,
        job.end,
        job.assigneeId,
      ]);
      // A finished job means a completed booking; unfinished work is a confirmed booking.
      expect(booking!.status, `${job.id}: booking status`).toBe(job.status === "completed" ? "completed" : "confirmed");
    }
    // Every booking that names a job has that job.
    for (const booking of BOOKINGS.filter((item) => item.jobId)) {
      expect(getJobById(booking.jobId!, OPERATIONS)?.bookingId, `${booking.id}: job points back`).toBe(booking.id);
    }
  });

  test("statuses are the locked sets", () => {
    expect([...new Set(BOOKINGS.map((booking) => booking.status))].sort()).toEqual(["completed", "confirmed", "pending"]);
    // Nothing is in progress at the baseline (JB-204 is completed); "in-progress" is reached by starting a scheduled job.
    expect([...new Set(JOBS.map((job) => job.status))].sort()).toEqual(["completed", "scheduled"]);
    expect(BOOKING_TABS.map((tab) => tab.status)).toEqual(["pending", "confirmed", "completed", "cancelled"]);
  });

  test("JB-204 belongs to Sarah Mitchell, AC Repair & Diagnostics, 1402 Kinney Ave", () => {
    const job = getJobById("JB-204", OPERATIONS)!;
    expect(getPartyName(job, DIR)).toBe("Sarah Mitchell");
    expect(getServiceNameFor(job, DIR)).toBe("AC Repair & Diagnostics");
    expect(formatPropertyAddress(getPropertyById(job.propertyId!, BOOK)!)).toBe("1402 Kinney Ave, Austin, TX 78704");
    expect(job.bookingId).toBe("BK-1042");
    expect(job.status).toBe("completed");
    expect(job.completion?.at).toBe(PROTOTYPE_NOW);
    expect(getBookingById("BK-1042", OPERATIONS)?.status).toBe("completed");
    expect(job.files).toHaveLength(4);
  });

  test("Elena Rodriguez is canonical; the stale name appears nowhere", () => {
    expect(getCustomerById("elena-rodriguez", BOOK)?.name).toBe("Elena Rodriguez");
    expect(getPartyName(getBookingById("BK-1035", OPERATIONS)!, DIR)).toBe("Elena Rodriguez");
    expect(getPartyName(getJobById("JB-198", OPERATIONS)!, DIR)).toBe("Elena Rodriguez");
    expect(JSON.stringify({ CUSTOMERS, BOOKINGS, JOBS })).not.toContain("Rostova");
  });

  test("Overview aggregates stay aggregates and are not backed by invented records", () => {
    expect(overviewMetrics.bookings).toBe(24);
    expect(overviewMetrics.completedJobs).toBe(18);
    expect(BOOKINGS.length).toBeLessThan(overviewMetrics.bookings);
    expect(JOBS.filter((job) => job.status === "completed").length).toBeLessThan(overviewMetrics.completedJobs);
  });

  test("customer 'upcoming' text agrees with the confirmed bookings", () => {
    for (const customer of CUSTOMERS.filter((item) => item.upcoming)) {
      const match = getBookingsForCustomer(customer.id, OPERATIONS).find(
        (booking) => booking.status === "confirmed" && `${booking.date}T${booking.start}` === customer.upcoming!.at.slice(0, 16),
      );
      expect(match, `${customer.name}: confirmed booking at ${customer.upcoming!.at}`).toBeDefined();
    }
    // Sarah's last service is a real job.
    expect(getJobById(getCustomerById("sarah-mitchell", BOOK)!.lastService!.jobId!, OPERATIONS)?.customerId).toBe("sarah-mitchell");
  });

  test("selectors group records by customer; jobs are newest first", () => {
    expect(getBookingsForCustomer("sarah-mitchell", OPERATIONS).map((booking) => booking.id)).toEqual(["BK-1042"]);
    expect(getJobsForCustomer("sarah-mitchell", OPERATIONS).map((job) => job.id)).toEqual(["JB-204", "JB-142"]);
    expect(getJobsForCustomer("david-chen", OPERATIONS).map((job) => job.id)).toEqual(["JB-201", "JB-178"]);
    expect(getAssigneeName(getJobById("JB-204", OPERATIONS)!, DIR)).toBe("Alex Morgan");
    expect(getAssigneeName(getJobById("JB-198", OPERATIONS)!, DIR)).toBeUndefined();
  });
});

test.describe("team", () => {
  test("Marcus Vance is a Technician and the team has three members", () => {
    expect(TEAM.map((member) => member.name)).toEqual(["Alex Morgan", "Marcus Vance", "Samira Patel"]);
    expect(getTeamMemberById("marcus-vance", TEAM_DATA)).toMatchObject({ name: "Marcus Vance", role: "Technician" });
    expect(getTeamMemberById("alex-morgan", TEAM_DATA)).toMatchObject({ role: "Operations Lead" });
  });
});

test.describe("schedule events", () => {
  test("are derived from jobs and bookings, never from pending or cancelled bookings", () => {
    const events = getScheduleEvents(OPERATIONS);
    const work = events.filter((event) => event.kind === "work");
    expect(work.map((event) => event.id)).toEqual(expect.arrayContaining(["JB-204", "JB-201", "JB-198", "JB-195", "JB-189"]));
    // BK-1041 is confirmed with no job: it appears as the booking.
    expect(events.find((event) => event.id === "BK-1041")).toMatchObject({ kind: "work", status: "confirmed", date: "2024-10-28" });
    // Pending requests are not on the calendar.
    expect(events.some((event) => event.id === "BK-1040" || event.id === "BK-1038")).toBe(false);
    // A booking that has a job is not shown twice.
    expect(events.filter((event) => event.kind === "work" && event.bookingId === "BK-1042")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "block")).toHaveLength(SCHEDULE_BLOCKS.length);
  });

  test("are ordered by date and start", () => {
    const keys = getScheduleEvents(OPERATIONS).map((event) => `${event.date}T${event.start}`);
    expect(keys).toEqual([...keys].sort());
  });

  test("getScheduleEventsForDate returns exactly that day, with no drift", () => {
    expect(getScheduleEventsForDate("2024-10-25", OPERATIONS).map((event) => event.id)).toEqual(["JB-186", "BLK-2", "JB-204", "JB-201", "JB-198"]);
    expect(getScheduleEventsForDate("2024-10-27", OPERATIONS)).toEqual([]);
    expect(getScheduleEventsForDate("2024-10-22", OPERATIONS).map((event) => event.id)).toEqual(["BLK-1"]);
  });

  test("unassigned work is confirmed or scheduled work with no technician", () => {
    expect(getUnassignedEvents(OPERATIONS).map((event) => event.id)).toEqual(["JB-198", "BK-1041"]);
  });
});

test.describe("dates, times and timezone", () => {
  test("today is the fixed prototype date, a Friday, in the Austin timezone", () => {
    expect(PROTOTYPE_TODAY).toBe("2024-10-25");
    expect(PROTOTYPE_NOW.startsWith(PROTOTYPE_TODAY)).toBe(true);
    expect(weekdayIndex(PROTOTYPE_TODAY)).toBe(5);
    expect(BUSINESS_TIME_ZONE).toBe("America/Chicago");
  });

  test("date helpers are calendar arithmetic, independent of the machine's timezone and DST", () => {
    expect(addDays("2024-10-25", 1)).toBe("2024-10-26");
    expect(addDays("2024-10-31", 1)).toBe("2024-11-01");
    // Daylight saving ends Nov 3, 2024 in Austin: still exactly one calendar day apart.
    expect(addDays("2024-11-02", 1)).toBe("2024-11-03");
    expect(addDays("2024-11-03", 1)).toBe("2024-11-04");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(startOfWeek("2024-10-25")).toBe("2024-10-21");
    expect(startOfWeek("2024-10-27")).toBe("2024-10-21");
    expect(weekDates("2024-10-25")).toEqual([
      "2024-10-21",
      "2024-10-22",
      "2024-10-23",
      "2024-10-24",
      "2024-10-25",
      "2024-10-26",
      "2024-10-27",
    ]);
    expect(formatLongDate("2024-10-25")).toBe("Friday, October 25, 2024");
    expect(formatTime("13:30")).toBe("1:30 PM");
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTimeRange("10:00", "12:00")).toBe("10:00 AM – 12:00 PM");
  });

  test("structured business hours match the approved display strings", () => {
    const to24 = (text: string) => {
      const [, hour, minute, meridiem] = /^(\d+):(\d+) (AM|PM)$/.exec(text.trim())!;
      const h = (Number(hour) % 12) + (meridiem === "PM" ? 12 : 0);
      return `${String(h).padStart(2, "0")}:${minute}`;
    };
    const parse = (hours: string) => {
      if (hours === "Closed") return null;
      const [open, close] = hours.split("–");
      return { open: to24(open), close: to24(close) };
    };
    const byLabel = Object.fromEntries(business.hours.map((row) => [row.days, parse(row.hours)]));
    for (const day of [1, 2, 3, 4, 5]) expect(businessHoursByWeekday[day]).toEqual(byLabel["Mon–Fri"]);
    expect(businessHoursByWeekday[6]).toEqual(byLabel["Sat"]);
    expect(businessHoursByWeekday[0]).toEqual(byLabel["Sun"]);
  });

  test("booking slots follow the booking method and the business hours", () => {
    // Fri Oct 25: instant booking → exact start times, all within 7:30–6:00.
    const instant = getSlotGroup("instant", "2024-10-25", 60);
    expect(instant.heading).toBe("Start time");
    expect(instant.slots.map((slot) => slot.start)).toEqual(["09:00", "11:30", "14:00", "16:00"]);
    expect(instant.slots.every((slot) => slot.available)).toBe(true);

    // Appointment request → 2-hour arrival windows.
    const windows = getSlotGroup("request-appointment", "2024-10-25", 120);
    expect(windows.heading).toBe("Arrival window (2 hours)");
    expect(windows.slots.every((slot) => slot.available)).toBe(true);

    // Quote / assessment → consultation slots.
    expect(getSlotGroup("request-quote", "2024-10-25", 60).heading).toBe("Consultation slot");

    // Saturday closes at 2 PM, so later windows are unavailable; Sunday is closed; the past is closed.
    const saturday = getSlotGroup("request-appointment", "2024-10-26", 120);
    expect(saturday.slots.filter((slot) => slot.available).map((slot) => slot.label)).toEqual(["Morning", "Midday"]);
    const sunday = getSlotGroup("instant", "2024-10-27", 60);
    expect(sunday.slots).toEqual([]);
    expect(sunday.unavailableReason).toMatch(/closed on Sun/i);
    expect(getSlotGroup("instant", "2024-10-24", 60).unavailableReason).toMatch(/already passed/i);
  });
});

test.describe("operation rules (the checks the server runs before it writes)", () => {
  const valid = {
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "annual-cooling-tune-up",
    source: "Phone / Front desk",
    date: "2024-10-29",
    start: "09:00",
    end: "10:00",
    assigneeId: "marcus-vance",
    internalNotes: "  Gate code on file.  ",
  };

  test("display numbers are BK-/JB- plus a positive integer, and nothing else is a reference", () => {
    expect(numberOf("BK", "BK-1042")).toBe(1042);
    expect(numberOf("JB", "JB-204")).toBe(204);
    expect(bookingReference(1043)).toBe("BK-1043");
    expect(jobReference(205)).toBe("JB-205");
    for (const bad of ["JB-204", "BK-0", "BK-", "bk-1042", "BK-1042 ", "BK-1e3", "BK--1", "BK-99999999999", "", undefined, null, 1042, {}]) {
      expect(numberOf("BK", bad), String(bad)).toBeUndefined();
    }
    expect(numberOf("JB", "BK-1042")).toBeUndefined();
    // Public references of customers, services and team members are slugs.
    expect(slugOf("sarah-mitchell")).toBe("sarah-mitchell");
    for (const bad of ["Sarah Mitchell", "../x", "", "a".repeat(101), 5, undefined]) expect(slugOf(bad), String(bad)).toBeUndefined();
  });

  test("a booking entered by staff, or for a plan, is confirmed; a customer's own request waits unless the service books instantly", () => {
    for (const source of ["Phone / Front desk", "Email", "Walk-in", "Other", "Maintenance plan"] as const) {
      for (const method of ["instant", "request-appointment", "request-quote"] as const) expect(initialBookingStatus(source, method), `${source} / ${method}`).toBe("confirmed");
    }
    for (const source of ["Website", "Booking link", "Marketplace"] as const) {
      expect(initialBookingStatus(source, "instant"), source).toBe("confirmed");
      expect(initialBookingStatus(source, "request-appointment"), source).toBe("pending");
      expect(initialBookingStatus(source, "request-quote"), source).toBe("pending");
    }
  });

  test("a complete booking is understood, and its free text is trimmed", () => {
    const parsed = parseNewBooking(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toMatchObject({ customerId: "sarah-mitchell", propertyId: "prop-sarah-home", serviceId: "annual-cooling-tune-up", date: "2024-10-29", internalNotes: "Gate code on file." });
  });

  test("a booking is for a customer or for a named person, never both and never neither; a property needs its customer", () => {
    const { customerId, propertyId, ...rest } = valid;
    expect(customerId && propertyId).toBeTruthy();
    expect(parseNewBooking({ ...rest, contactName: "Claire Dubois" }).ok).toBe(true);
    expect(parseNewBooking({ ...rest }).ok).toBe(false);
    expect(parseNewBooking({ ...valid, contactName: "Claire Dubois" }).ok).toBe(false);
    expect(parseNewBooking({ ...rest, propertyId: "prop-sarah-home", contactName: "Claire Dubois" }).ok).toBe(false);
    // A customer's contact details come from their record, not from the request.
    expect(parseNewBooking({ ...valid, contact: { phone: "5125550100" } }).ok).toBe(false);
    expect(parseNewBooking({ ...rest, contactName: "Claire Dubois", contact: { email: "not-an-email" } }).ok).toBe(false);
  });

  test("malformed bookings are refused, whatever the browser sends", () => {
    const bad: unknown[] = [
      null,
      "booking",
      [],
      { ...valid, serviceId: "Annual Cooling Tune-Up" },
      { ...valid, serviceId: undefined },
      { ...valid, source: "Telepathy" },
      { ...valid, date: "2024-02-30" },
      { ...valid, date: "10/29/2024" },
      { ...valid, start: "9:00" },
      { ...valid, start: "25:00" },
      { ...valid, end: "09:00" },
      { ...valid, end: "08:00" },
      { ...valid, assigneeId: "Marcus Vance" },
      { ...valid, internalNotes: "x".repeat(2001) },
      { ...valid, organizationId: undefined, customerId: 7 },
    ];
    for (const input of bad) expect(parseNewBooking(input).ok, JSON.stringify(input)).toBe(false);
  });

  test("no organization is read from the request: a stray organizationId field is ignored, never trusted", () => {
    const parsed = parseNewBooking({ ...valid, organizationId: "00000000-0000-0000-0000-000000000000", organization_id: "x" });
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("0000-0000");
  });

  test("a time is bookable only on an open day, inside the saved hours, and not in the past", () => {
    const hours = businessHoursByWeekday;
    const today = "2024-10-25";
    expect(slotError("2024-10-28", "09:00", "11:00", hours, today)).toBeUndefined();
    expect(slotError("2024-10-25", "09:00", "11:00", hours, today)).toBeUndefined();
    expect(slotError("2024-10-24", "09:00", "11:00", hours, today)).toMatch(/already passed/);
    expect(slotError("2024-10-27", "09:00", "11:00", hours, today)).toMatch(/closed/);
    expect(slotError("2024-10-28", "06:00", "08:00", hours, today)).toMatch(/outside the business hours/);
    expect(slotError("2024-10-28", "17:00", "19:00", hours, today)).toMatch(/outside the business hours/);
    // Saturday closes at 2 PM.
    expect(slotError("2024-10-26", "13:00", "15:00", hours, today)).toMatch(/outside the business hours/);
    // The same rule against another business's clock: the day is "today" in ITS time zone.
    expect(slotError("2024-10-25", "09:00", "11:00", hours, "2026-10-09")).toMatch(/already passed/);
  });

  test("confirming: only a pending request", () => {
    expect(confirmError({ status: "pending" })).toBeUndefined();
    expect(confirmError({ status: "confirmed" })).toMatch(/already confirmed/);
    expect(confirmError({ status: "completed" })).toBeTruthy();
    expect(confirmError({ status: "cancelled" })).toBeTruthy();
  });

  test("declining or cancelling: pending or confirmed, with no job, with a reason", () => {
    expect(cancelError({ status: "pending" })).toBeUndefined();
    expect(cancelError({ status: "confirmed" })).toBeUndefined();
    expect(cancelError({ status: "confirmed", jobId: "JB-201" })).toMatch(/has a job/);
    expect(cancelError({ status: "completed", jobId: "JB-204" })).toMatch(/completed/);
    expect(cancelError({ status: "cancelled" })).toMatch(/already cancelled/);
    expect(parseReason("  Outside service area.  ")).toEqual({ ok: true, value: "Outside service area." });
    for (const bad of ["", "   ", undefined, 5, "x".repeat(1001)]) expect(parseReason(bad).ok, String(bad)).toBe(false);
  });

  test("assigning: not a pending request, and never completed or cancelled work; only an active, field-assignable member", () => {
    expect(assignBookingError({ status: "confirmed" })).toBeUndefined();
    for (const status of ["pending", "completed", "cancelled"] as const) expect(assignBookingError({ status }), status).toBeTruthy();
    expect(assignJobError({ status: "scheduled" })).toBeUndefined();
    expect(assignJobError({ status: "in-progress" })).toBeUndefined();
    expect(assignJobError({ status: "completed" })).toBeTruthy();
    expect(assignableError({ status: "active", fieldAssignable: true })).toBeUndefined();
    expect(assignableError({ status: "inactive", fieldAssignable: true })).toBeTruthy();
    expect(assignableError({ status: "invited", fieldAssignable: true })).toBeTruthy();
    expect(assignableError({ status: "active", fieldAssignable: false })).toBeTruthy();
    expect(assignableError(undefined)).toMatch(/isn't on your team/);
  });

  test("a job is created from a confirmed booking that has none; the job life cycle only moves forward and completed is final", () => {
    expect(createJobError({ status: "confirmed" })).toBeUndefined();
    expect(createJobError({ status: "confirmed", jobId: "JB-205" })).toMatch(/already has a job/);
    for (const status of ["pending", "completed", "cancelled"] as const) expect(createJobError({ status }), status).toBeTruthy();

    expect(startJobError({ status: "scheduled" })).toBeUndefined();
    expect(startJobError({ status: "in-progress" })).toBeTruthy();
    expect(startJobError({ status: "completed" })).toBeTruthy();
    expect(completeJobError({ status: "in-progress" })).toBeUndefined();
    expect(completeJobError({ status: "scheduled" })).toMatch(/Start the job/);
    expect(completeJobError({ status: "completed" })).toMatch(/already completed/);
    expect(detailsError({ status: "scheduled" })).toBeUndefined();
    expect(detailsError({ status: "in-progress" })).toBeUndefined();
    expect(detailsError({ status: "completed" })).toMatch(/final/);
  });

  test("work details: only the four editable fields, bounded; completion needs resolution notes", () => {
    expect(parseDetailsPatch({ internalNotes: "New note", workPerformed: "" })).toEqual({ ok: true, value: { internalNotes: "New note", workPerformed: "" } });
    expect(parseDetailsPatch({}).ok).toBe(true);
    for (const bad of [null, "x", [], { status: "completed" }, { checklist: [] }, { customerRequest: "x" }, { internalNotes: 5 }, { internalNotes: "x".repeat(10_001) }]) {
      expect(parseDetailsPatch(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseCompletionNotes("  Replaced the run capacitor.  ")).toEqual({ ok: true, value: "Replaced the run capacitor." });
    for (const bad of ["", "  ", undefined, 3, "x".repeat(10_001)]) expect(parseCompletionNotes(bad).ok, String(bad)).toBe(false);
  });

  test("BK-1048 is held for Sarah's included cooling visit", () => {
    expect(RESERVED_BOOKING_NUMBERS).toEqual({ "plan-sarah-comfort-care-v2": 1048 });
  });

  test("the rules never mutate their input", () => {
    const frozen = JSON.stringify(valid);
    parseNewBooking(valid);
    expect(JSON.stringify(valid)).toBe(frozen);
    expect(JSON.stringify(OPERATIONS)).toBe(JSON.stringify(OPERATIONS));
  });
});

test.describe("source guardrails (operations)", () => {
  const PROHIBITED = [
    "Elena Rostova",
    "dispatch center",
    "dispatch queue",
    "fleet",
    "telemetry",
    "GPS tracking",
    "route optimization",
    "smart routing",
    "AI scheduling",
    "workload optimization",
    "technician performance score",
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|css|md)$/.test(entry) ? [path] : [];
    });
  }

  test("production source contains none of the prohibited operational concepts", () => {
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of PROHIBITED) if (text.includes(phrase.toLowerCase())) hits.push(`${file}: ${phrase}`);
    }
    expect(hits).toEqual([]);
  });

  test("operational code never reads the real clock or the browser's timezone", () => {
    const files = [...sourceFiles("src/components/operations"), ...sourceFiles("src/components/bookings"), ...sourceFiles("src/components/schedule"), ...sourceFiles("src/components/jobs")]
      .concat(["src/data/operations.ts", "src/lib/operations-rules.ts", "src/lib/booking-slots.ts", "src/lib/dates.ts"]);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/new Date\(\s*\)/, /Date\.now\(/, /Intl\.DateTimeFormat/, /toLocale(Date|Time)?String/, /getTimezoneOffset/]) {
        if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("cancelled bookings keep a reason and the tab model has no extras", () => {
    for (const booking of BOOKINGS.filter((item) => item.status === "cancelled")) expect(booking.cancellation?.reason).toBeTruthy();
    expect(BOOKING_TABS.map((tab) => tab.label)).toEqual(["Requests", "Upcoming", "Past", "Cancelled"]);
  });
});
