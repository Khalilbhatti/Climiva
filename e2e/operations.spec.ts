import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { formatPropertyAddress, getCustomerById, getPropertyById } from "../src/data/customers";
import {
  BOOKINGS,
  BOOKING_TABS,
  JOBS,
  OPERATIONS,
  SCHEDULE_BLOCKS,
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
  type OperationsData,
} from "../src/data/operations";
import { PROTOTYPE_NOW, PROTOTYPE_TODAY, BUSINESS_TIME_ZONE, business, businessHoursByWeekday, overviewMetrics } from "../src/data/fixtures";
import { getServiceById } from "../src/data/services";
import { getTeamMemberById } from "../src/data/team";
import { getSlotGroup } from "../src/lib/booking-slots";
import { addDays, formatLongDate, formatTime, formatTimeRange, startOfWeek, weekDates, weekdayIndex } from "../src/lib/dates";
import {
  addJobFiles,
  assign,
  cancelBooking,
  completeJob,
  confirmBooking,
  createBooking,
  createJobForBooking,
  nextId,
  setFileVisibility,
  startJob,
  updateJobDetails,
} from "../src/lib/operations-state";
import { BOOK, CUSTOMERS, DIR, SERVICES, TEAM, TEAM_DATA } from "./apex-data";

// Pure data/selector/state tests: no browser needed.

const snapshot = () => JSON.stringify(OPERATIONS);

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
      const booking = getBookingById(job.bookingId);
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
      expect(getJobById(booking.jobId!)?.bookingId, `${booking.id}: job points back`).toBe(booking.id);
    }
  });

  test("statuses are the locked sets", () => {
    expect([...new Set(BOOKINGS.map((booking) => booking.status))].sort()).toEqual(["completed", "confirmed", "pending"]);
    // Nothing is in progress at the baseline (JB-204 is completed); "in-progress" is reached by starting a scheduled job.
    expect([...new Set(JOBS.map((job) => job.status))].sort()).toEqual(["completed", "scheduled"]);
    expect(BOOKING_TABS.map((tab) => tab.status)).toEqual(["pending", "confirmed", "completed", "cancelled"]);
  });

  test("JB-204 belongs to Sarah Mitchell, AC Repair & Diagnostics, 1402 Kinney Ave", () => {
    const job = getJobById("JB-204")!;
    expect(getPartyName(job, DIR)).toBe("Sarah Mitchell");
    expect(getServiceNameFor(job, DIR)).toBe("AC Repair & Diagnostics");
    expect(formatPropertyAddress(getPropertyById(job.propertyId!, BOOK)!)).toBe("1402 Kinney Ave, Austin, TX 78704");
    expect(job.bookingId).toBe("BK-1042");
    expect(job.status).toBe("completed");
    expect(job.completion?.at).toBe(PROTOTYPE_NOW);
    expect(getBookingById("BK-1042")?.status).toBe("completed");
    expect(job.files).toHaveLength(4);
  });

  test("Elena Rodriguez is canonical; the stale name appears nowhere", () => {
    expect(getCustomerById("elena-rodriguez", BOOK)?.name).toBe("Elena Rodriguez");
    expect(getPartyName(getBookingById("BK-1035")!, DIR)).toBe("Elena Rodriguez");
    expect(getPartyName(getJobById("JB-198")!, DIR)).toBe("Elena Rodriguez");
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
      const match = getBookingsForCustomer(customer.id).find(
        (booking) => booking.status === "confirmed" && `${booking.date}T${booking.start}` === customer.upcoming!.at.slice(0, 16),
      );
      expect(match, `${customer.name}: confirmed booking at ${customer.upcoming!.at}`).toBeDefined();
    }
    // Sarah's last service is a real job.
    expect(getJobById(getCustomerById("sarah-mitchell", BOOK)!.lastService!.jobId!)?.customerId).toBe("sarah-mitchell");
  });

  test("selectors group records by customer; jobs are newest first", () => {
    expect(getBookingsForCustomer("sarah-mitchell").map((booking) => booking.id)).toEqual(["BK-1042"]);
    expect(getJobsForCustomer("sarah-mitchell").map((job) => job.id)).toEqual(["JB-204", "JB-142"]);
    expect(getJobsForCustomer("david-chen").map((job) => job.id)).toEqual(["JB-201", "JB-178"]);
    expect(getAssigneeName(getJobById("JB-204")!, DIR)).toBe("Alex Morgan");
    expect(getAssigneeName(getJobById("JB-198")!, DIR)).toBeUndefined();
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
    const events = getScheduleEvents();
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
    const keys = getScheduleEvents().map((event) => `${event.date}T${event.start}`);
    expect(keys).toEqual([...keys].sort());
  });

  test("getScheduleEventsForDate returns exactly that day, with no drift", () => {
    expect(getScheduleEventsForDate("2024-10-25").map((event) => event.id)).toEqual(["JB-186", "BLK-2", "JB-204", "JB-201", "JB-198"]);
    expect(getScheduleEventsForDate("2024-10-27")).toEqual([]);
    expect(getScheduleEventsForDate("2024-10-22").map((event) => event.id)).toEqual(["BLK-1"]);
  });

  test("unassigned work is confirmed or scheduled work with no technician", () => {
    expect(getUnassignedEvents().map((event) => event.id)).toEqual(["JB-198", "BK-1041"]);
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

test.describe("in-memory state transitions", () => {
  const input = {
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: "annual-cooling-tune-up",
    source: "Phone / Front desk" as const,
    date: "2024-10-29",
    start: "09:00",
    end: "10:00",
    assigneeId: "marcus-vance",
    internalNotes: "  Gate code on file.  ",
  };

  test("nextId continues after the highest id", () => {
    expect(nextId("BK", BOOKINGS.map((booking) => booking.id))).toBe("BK-1043");
    expect(nextId("JB", JOBS.map((job) => job.id))).toBe("JB-205");
    expect(nextId("BK", [])).toBe("BK-1");
  });

  test("createBooking adds a confirmed booking and never mutates the fixtures", () => {
    const before = snapshot();
    const { data, booking } = createBooking(OPERATIONS, input);
    expect(booking).toMatchObject({
      id: "BK-1043",
      status: "confirmed",
      customerId: "sarah-mitchell",
      propertyId: "prop-sarah-home",
      receivedAt: PROTOTYPE_NOW,
      internalNotes: "Gate code on file.",
    });
    expect(data.bookings).toHaveLength(BOOKINGS.length + 1);
    expect(getBookingsForCustomer("sarah-mitchell", data).map((item) => item.id)).toEqual(["BK-1042", "BK-1043"]);
    // The new booking is on the calendar on its date, with the chosen technician.
    expect(getScheduleEventsForDate("2024-10-29", data)).toMatchObject([{ id: "BK-1043", assigneeId: "marcus-vance", status: "confirmed" }]);
    expect(snapshot()).toBe(before);
    expect(OPERATIONS.bookings).toHaveLength(BOOKINGS.length);
  });

  test("confirm and decline/cancel only apply where they make sense", () => {
    const confirmed = confirmBooking(OPERATIONS, "BK-1040");
    expect(getBookingById("BK-1040", confirmed)).toMatchObject({ status: "confirmed", confirmedAt: PROTOTYPE_NOW });
    expect(getScheduleEvents(confirmed).some((event) => event.id === "BK-1040")).toBe(true);

    const declined = cancelBooking(OPERATIONS, "BK-1038", "  Outside service area.  ");
    expect(getBookingById("BK-1038", declined)).toMatchObject({ status: "cancelled", cancellation: { reason: "Outside service area." } });
    expect(getScheduleEvents(declined).some((event) => event.id === "BK-1038")).toBe(false);

    // A booking with a job, and a booking that is already completed, cannot be cancelled.
    expect(getBookingById("BK-1039", cancelBooking(OPERATIONS, "BK-1039", "x"))?.status).toBe("confirmed");
    expect(getBookingById("BK-1042", cancelBooking(OPERATIONS, "BK-1042", "x"))?.status).toBe("completed");
    expect(getBookingById("BK-1006", cancelBooking(OPERATIONS, "BK-1006", "x"))?.status).toBe("completed");
    // Confirming something that isn't pending changes nothing.
    expect(getBookingById("BK-1041", confirmBooking(OPERATIONS, "BK-1041"))).toEqual(getBookingById("BK-1041"));
  });

  test("assign updates the booking and its job together", () => {
    const viaBooking = assign(OPERATIONS, { bookingId: "BK-1035" }, "samira-patel");
    expect(getBookingById("BK-1035", viaBooking)?.assigneeId).toBe("samira-patel");
    expect(getJobById("JB-198", viaBooking)?.assigneeId).toBe("samira-patel");
    expect(getUnassignedEvents(viaBooking).map((event) => event.id)).toEqual(["BK-1041"]);

    const viaJob = assign(OPERATIONS, { jobId: "JB-201" }, undefined);
    expect(getJobById("JB-201", viaJob)?.assigneeId).toBeUndefined();
    expect(getBookingById("BK-1039", viaJob)?.assigneeId).toBeUndefined();
    expect(getUnassignedEvents(viaJob).map((event) => event.id)).toContain("JB-201");
  });

  test("createJobForBooking links a scheduled job to a confirmed booking, once", () => {
    const { data, job } = createJobForBooking(OPERATIONS, "BK-1041");
    expect(job).toMatchObject({
      id: "JB-205",
      bookingId: "BK-1041",
      contactName: "Robert Ramirez",
      serviceId: "furnace-safety-inspection",
      status: "scheduled",
      date: "2024-10-28",
    });
    expect(getBookingById("BK-1041", data)?.jobId).toBe("JB-205");
    // The calendar still shows one event for the work, now keyed by the job.
    const events = getScheduleEventsForDate("2024-10-28", data);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "JB-205", bookingId: "BK-1041" });

    expect(createJobForBooking(data, "BK-1041").job).toBeUndefined(); // already has a job
    expect(createJobForBooking(OPERATIONS, "BK-1040").job).toBeUndefined(); // pending, not confirmed
    expect(createJobForBooking(OPERATIONS, "BK-1006").job).toBeUndefined(); // completed
  });

  test("start and complete a job: statuses stay consistent, nothing financial is created", () => {
    const before = snapshot();
    const started = startJob(OPERATIONS, "JB-201");
    expect(getJobById("JB-201", started)?.status).toBe("in-progress");
    // JB-204 is already completed at the baseline: starting or completing it again changes nothing.
    expect(getJobById("JB-204", startJob(OPERATIONS, "JB-204"))?.status).toBe("completed");
    expect(completeJob(OPERATIONS, "JB-204", "again")).toBe(OPERATIONS);

    const completed = completeJob(started, "JB-201", "  Replaced the run capacitor.  ");
    expect(getJobById("JB-201", completed)).toMatchObject({
      status: "completed",
      completion: { notes: "Replaced the run capacitor.", at: PROTOTYPE_NOW },
    });
    expect(getBookingById("BK-1039", completed)?.status).toBe("completed");
    expect(getScheduleEventsForDate("2024-10-25", completed).find((event) => event.id === "JB-201")).toMatchObject({ status: "completed" });
    expect(getUnassignedEvents(completed).some((event) => event.id === "JB-201")).toBe(false);

    // A completion only touches jobs and bookings: the data shape has no quote, invoice or payment.
    expect(Object.keys(completed).sort()).toEqual(["blocks", "bookings", "jobs"]);
    expect(completed.bookings).toHaveLength(BOOKINGS.length);
    expect(completed.jobs).toHaveLength(JOBS.length);
    expect(JSON.stringify(completed)).not.toMatch(/invoice|quote|payment/i);

    // Completing again does nothing; the fixtures are untouched.
    expect(completeJob(completed, "JB-201", "again")).toBe(completed);
    expect(snapshot()).toBe(before);
  });

  test("work details and photos update only the targeted job", () => {
    const before = snapshot();
    const edited = updateJobDetails(OPERATIONS, "JB-204", { internalNotes: "New note" });
    expect(getJobById("JB-204", edited)?.details.internalNotes).toBe("New note");
    expect(getJobById("JB-204", edited)?.details.technicianDiagnosis).toBe(getJobById("JB-204")!.details.technicianDiagnosis);

    const file = { id: "file-new", name: "IMG_9999.jpg", sizeKb: 800, visibility: "internal" as const };
    const withFile = addJobFiles(OPERATIONS, "JB-204", [file]);
    expect(getJobById("JB-204", withFile)!.files).toHaveLength(5);
    expect(getJobById("JB-201", withFile)!.files).toHaveLength(0);

    const shared = setFileVisibility(withFile, "JB-204", "file-new", "customer");
    expect(getJobById("JB-204", shared)!.files.find((item) => item.id === "file-new")?.visibility).toBe("customer");
    expect(snapshot()).toBe(before);
  });

  test("a state transition never mutates the data it is given", () => {
    const start: OperationsData = JSON.parse(snapshot());
    const frozen = JSON.stringify(start);
    let data: OperationsData = start;
    data = createBooking(data, input).data;
    data = confirmBooking(data, "BK-1040");
    data = cancelBooking(data, "BK-1038", "reason");
    data = assign(data, { bookingId: "BK-1041" }, "alex-morgan");
    data = createJobForBooking(data, "BK-1041").data;
    data = startJob(data, "JB-205");
    data = completeJob(data, "JB-205", "Done");
    expect(data).not.toBe(start);
    expect(JSON.stringify(start)).toBe(frozen);
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
      .concat(["src/data/operations.ts", "src/lib/operations-state.ts", "src/lib/booking-slots.ts", "src/lib/dates.ts"]);
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
