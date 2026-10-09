/**
 * Operations: the queries.
 *
 * Like the other query modules, every function takes an open transaction (`tx`) and the organization it works for, and names
 * that organization in every statement's WHERE clause. They are meant to be called from `withTenant(...)`, where Row Level
 * Security enforces the same boundary again. The seed calls the same functions on the owner connection, so the data it writes
 * is exactly what the application reads.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may
 * import this file (a test enforces it).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { OperationsData } from "@/data/operations";
import { localToInstant } from "@/lib/business-time";
import { numberOf } from "@/lib/operations-rules";
import { blockFromRow, bookingFromRow, jobFromRow, type SlugLookup } from "./ops-mappers";
import type { Tx } from "./index";
import {
  bookings,
  customerProperties,
  customers,
  equipment,
  jobFiles,
  jobs,
  organizationSequences,
  scheduleBlockMembers,
  scheduleBlocks,
  services,
  teamMembers,
} from "./schema";
import type { BookingRow, JobRow } from "./schema";
import { stableId } from "./stable-id";

export type IdOptions = { stableIds?: boolean };

const idFor = (options: IdOptions, organizationId: string, kind: string, reference: string) =>
  options.stableIds ? { id: stableId(organizationId, kind, reference) } : {};

/* ───────────────────────── what points at what ───────────────────────── */

/**
 * The public references of one business's customers, properties, Services, Team members and equipment, both ways. Only this
 * business's rows are ever read, so a slug that belongs to another business is simply absent.
 */
export type Refs = {
  slugs: SlugLookup;
  idBySlug: {
    customers: ReadonlyMap<string, string>;
    properties: ReadonlyMap<string, string>;
    services: ReadonlyMap<string, string>;
    members: ReadonlyMap<string, string>;
    equipment: ReadonlyMap<string, string>;
  };
  /** The customer each property belongs to, by property id. */
  propertyOwner: ReadonlyMap<string, string>;
};

const flip = (map: ReadonlyMap<string, string>) => new Map([...map].map(([key, value]) => [value, key]));

export async function loadRefs(tx: Tx, organizationId: string): Promise<Refs> {
  const [customerRows, propertyRows, serviceRows, memberRows, equipmentRows] = [
    await tx.select({ id: customers.id, slug: customers.slug }).from(customers).where(eq(customers.organizationId, organizationId)),
    await tx.select({ id: customerProperties.id, slug: customerProperties.slug, customerId: customerProperties.customerId }).from(customerProperties).where(eq(customerProperties.organizationId, organizationId)),
    await tx.select({ id: services.id, slug: services.slug }).from(services).where(eq(services.organizationId, organizationId)),
    await tx.select({ id: teamMembers.id, slug: teamMembers.slug }).from(teamMembers).where(eq(teamMembers.organizationId, organizationId)),
    await tx.select({ id: equipment.id, slug: equipment.slug }).from(equipment).where(eq(equipment.organizationId, organizationId)),
  ];
  const toMap = (rows: readonly { id: string; slug: string }[]) => new Map(rows.map((row) => [row.id, row.slug]));
  const slugs: SlugLookup = {
    customers: toMap(customerRows),
    properties: toMap(propertyRows),
    services: toMap(serviceRows),
    members: toMap(memberRows),
    equipment: toMap(equipmentRows),
  };
  return {
    slugs,
    idBySlug: {
      customers: flip(slugs.customers),
      properties: flip(slugs.properties),
      services: flip(slugs.services),
      members: flip(slugs.members),
      equipment: flip(slugs.equipment),
    },
    propertyOwner: new Map(propertyRows.map((row) => [row.id, row.customerId])),
  };
}

/* ───────────────────────── reading ───────────────────────── */

/** Every booking, job, file and block of one business, as the screens use them. */
export async function loadOperations(tx: Tx, organizationId: string, timeZone: string, refs?: Refs): Promise<OperationsData> {
  const resolved = refs ?? (await loadRefs(tx, organizationId));
  const bookingRows = await tx.select().from(bookings).where(eq(bookings.organizationId, organizationId)).orderBy(asc(bookings.number));
  const jobRows = await tx.select().from(jobs).where(eq(jobs.organizationId, organizationId)).orderBy(asc(jobs.number));
  const fileRows = await tx.select().from(jobFiles).where(eq(jobFiles.organizationId, organizationId)).orderBy(asc(jobFiles.position));
  const blockRows = await tx.select().from(scheduleBlocks).where(eq(scheduleBlocks.organizationId, organizationId)).orderBy(asc(scheduleBlocks.position));
  const blockMemberRows = await tx.select().from(scheduleBlockMembers).where(eq(scheduleBlockMembers.organizationId, organizationId));

  const bookingNumberById = new Map(bookingRows.map((row) => [row.id, row.number]));
  const jobNumberByBookingId = new Map(jobRows.flatMap((row) => (row.bookingId ? [[row.bookingId, row.number] as const] : [])));
  const filesByJob = new Map<string, typeof fileRows>();
  for (const file of fileRows) filesByJob.set(file.jobId, [...(filesByJob.get(file.jobId) ?? []), file]);
  const memberSlugsByBlock = new Map<string, string[]>();
  for (const link of blockMemberRows) {
    const slug = resolved.slugs.members.get(link.memberId);
    if (slug) memberSlugsByBlock.set(link.blockId, [...(memberSlugsByBlock.get(link.blockId) ?? []), slug]);
  }
  // A block's people read in a fixed order, whatever order PostgreSQL happens to return the link rows in.
  for (const slugs of memberSlugsByBlock.values()) slugs.sort((a, b) => a.localeCompare(b));

  return {
    bookings: bookingRows.map((row) => bookingFromRow(row, resolved.slugs, jobNumberByBookingId.get(row.id), timeZone)),
    jobs: jobRows.map((row) => jobFromRow(row, resolved.slugs, row.bookingId ? bookingNumberById.get(row.bookingId) : undefined, filesByJob.get(row.id) ?? [], timeZone)),
    blocks: blockRows.map((row) => blockFromRow(row, memberSlugsByBlock.get(row.id) ?? [])),
  };
}

/* ───────────────────────── numbers ───────────────────────── */

/** The next number of one kind for the ACTIVE organization (the context set by withTenant). Locks the counter until commit. */
export async function takeNumber(tx: Tx, kind: "booking" | "job"): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`select app_next_number(${kind}) as n`);
  return Number(result.rows[0].n);
}

/**
 * A new booking number. A number `reserved` for one maintenance plan visit (the sample business holds BK-1048 for Sarah's) is
 * never handed to anything else; the visit itself takes it while it is free. A number that already exists (a counter that
 * fell behind its data) is skipped. Other businesses reserve nothing.
 */
export async function allocateBookingNumber(tx: Tx, organizationId: string, reserved: Readonly<Record<string, number>>, planVisitId?: string): Promise<number> {
  const exists = async (number: number) =>
    (await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.number, number))).limit(1)).length > 0;
  const held = Object.values(reserved);
  const own = planVisitId ? reserved[planVisitId] : undefined;
  if (own !== undefined && !(await exists(own))) return own;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const number = await takeNumber(tx, "booking");
    if (!held.includes(number) && !(await exists(number))) return number;
  }
  throw new Error("Could not find a free booking number.");
}

export async function allocateJobNumber(tx: Tx, organizationId: string): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const number = await takeNumber(tx, "job");
    const taken = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.number, number))).limit(1);
    if (taken.length === 0) return number;
  }
  throw new Error("Could not find a free job number.");
}

/* ───────────────────────── locking a record ───────────────────────── */

/**
 * The booking and/or job a request names, found by display number, then locked: the booking first, the job second, always
 * in that order, so two requests that touch the same pair can never wait on each other. Undefined when a number names
 * nothing in this business, or a booking and a job that do not belong together.
 */
export async function lockRecords(tx: Tx, organizationId: string, target: { bookingNumber?: number; jobNumber?: number }): Promise<{ booking?: BookingRow; job?: JobRow } | undefined> {
  let bookingId: string | undefined;
  let jobId: string | undefined;
  if (target.jobNumber !== undefined) {
    const found = await tx.select().from(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.number, target.jobNumber))).limit(1);
    if (found.length === 0) return undefined;
    jobId = found[0].id;
    bookingId = found[0].bookingId ?? undefined;
  }
  if (target.bookingNumber !== undefined) {
    const found = await tx.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.number, target.bookingNumber))).limit(1);
    if (found.length === 0) return undefined;
    if (bookingId !== undefined && bookingId !== found[0].id) return undefined;
    bookingId = found[0].id;
    if (jobId === undefined) jobId = (await jobOfBooking(tx, organizationId, found[0].id))?.id;
  }
  const booking = bookingId === undefined ? undefined : (await tx.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1).for("update"))[0];
  const job = jobId === undefined ? undefined : (await tx.select().from(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, jobId))).limit(1).for("update"))[0];
  return { booking, job };
}

/** The booking's job, if it has one (a plain read: the booking row is what is locked). */
export async function jobOfBooking(tx: Tx, organizationId: string, bookingId: string): Promise<JobRow | undefined> {
  const rows = await tx.select().from(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.bookingId, bookingId))).limit(1);
  return rows[0];
}

/* ───────────────────────── seed and tests ───────────────────────── */

/** The largest number in use, per kind, so a counter starts above the data it was seeded with. */
const highest = (references: readonly string[], prefix: "BK" | "JB") => references.reduce((max, reference) => Math.max(max, numberOf(prefix, reference) ?? 0), 0);

/**
 * Write a whole set of operations for one business (the sample business, the second seed business, a test copy). Bookings
 * and jobs keep the numbers their references carry, the counters are set above the largest of them, and appointment times
 * are stored as the local times they are. Instants are read from the local wall-clock strings in the business's time zone.
 */
export async function insertOperations(tx: Tx, organizationId: string, timeZone: string, data: OperationsData, refs: Refs, options: IdOptions = {}): Promise<void> {
  const instant = (local: string | undefined) => (local ? localToInstant(local, timeZone) : null);
  const need = (map: ReadonlyMap<string, string>, slug: string | undefined, what: string): string | null => {
    if (slug === undefined) return null;
    const id = map.get(slug);
    if (!id) throw new Error(`Unknown ${what} "${slug}".`);
    return id;
  };

  const bookingIdByReference = new Map<string, string>();
  for (const booking of data.bookings) {
    const number = numberOf("BK", booking.id);
    if (number === undefined) throw new Error(`Not a booking reference: ${booking.id}`);
    const customerId = need(refs.idBySlug.customers, booking.customerId, "customer");
    const [row] = await tx
      .insert(bookings)
      .values({
        organizationId,
        ...idFor(options, organizationId, "booking", booking.id),
        number,
        customerId,
        propertyId: need(refs.idBySlug.properties, booking.propertyId, "property"),
        serviceId: need(refs.idBySlug.services, booking.serviceId, "service")!,
        assigneeId: need(refs.idBySlug.members, booking.assigneeId, "team member"),
        contactName: booking.contactName ?? null,
        contactPhone: booking.contact?.phone ?? null,
        contactEmail: booking.contact?.email ?? null,
        contactAddress: booking.contact?.address ?? null,
        source: booking.source ?? null,
        status: booking.status,
        serviceDate: booking.date,
        startTime: booking.start,
        endTime: booking.end,
        note: booking.note ?? null,
        intakeSystemType: booking.intake?.systemType ?? null,
        intakeEquipment: booking.intake?.equipment ?? null,
        intakeReportedIssue: booking.intake?.reportedIssue ?? null,
        internalNotes: booking.internalNotes ?? null,
        cancellationReason: booking.cancellation?.reason ?? null,
        planId: booking.planVisit?.planId ?? null,
        planVisitId: booking.planVisit?.visitId ?? null,
        receivedAt: instant(booking.receivedAt),
        confirmedAt: instant(booking.confirmedAt),
      })
      .returning({ id: bookings.id });
    bookingIdByReference.set(booking.id, row.id);
  }

  for (const job of data.jobs) {
    const number = numberOf("JB", job.id);
    if (number === undefined) throw new Error(`Not a job reference: ${job.id}`);
    const bookingId = job.bookingId ? bookingIdByReference.get(job.bookingId) : undefined;
    if (job.bookingId && !bookingId) throw new Error(`Unknown booking "${job.bookingId}".`);
    const [row] = await tx
      .insert(jobs)
      .values({
        organizationId,
        ...idFor(options, organizationId, "job", job.id),
        number,
        bookingId: bookingId ?? null,
        customerId: need(refs.idBySlug.customers, job.customerId, "customer"),
        propertyId: need(refs.idBySlug.properties, job.propertyId, "property"),
        serviceId: need(refs.idBySlug.services, job.serviceId, "service")!,
        assigneeId: need(refs.idBySlug.members, job.assigneeId, "team member"),
        equipmentId: need(refs.idBySlug.equipment, job.equipmentId, "equipment"),
        contactName: job.contactName ?? null,
        status: job.status,
        serviceDate: job.date,
        startTime: job.start,
        endTime: job.end,
        workSummary: job.workSummary ?? null,
        note: job.note ?? null,
        technicianDiagnosis: job.details.technicianDiagnosis ?? null,
        workPerformed: job.details.workPerformed ?? null,
        customerSummary: job.details.customerSummary ?? null,
        internalNotes: job.details.internalNotes ?? null,
        customerRequest: job.details.customerRequest ?? null,
        safetyNote: job.details.safetyNote ?? null,
        checklist: job.details.checklist ?? null,
        completionNotes: job.completion?.notes ?? null,
        completedAt: instant(job.completion?.at),
      })
      .returning({ id: jobs.id });
    for (const file of job.files) {
      await tx.insert(jobFiles).values({
        organizationId,
        ...idFor(options, organizationId, "job-file", `${job.id}/${file.id}`),
        jobId: row.id,
        ref: file.id,
        name: file.name,
        sizeKb: file.sizeKb,
        category: file.category ?? null,
        caption: file.caption ?? null,
        takenAt: file.takenAt ?? null,
        visibility: file.visibility,
        badge: file.badge ?? null,
        storageKey: null,
      });
    }
  }

  for (const block of data.blocks) {
    const [row] = await tx
      .insert(scheduleBlocks)
      .values({
        organizationId,
        ...idFor(options, organizationId, "block", block.id),
        ref: block.id,
        title: block.title,
        serviceDate: block.date,
        startTime: block.start,
        endTime: block.end,
      })
      .returning({ id: scheduleBlocks.id });
    for (const slug of block.memberIds) {
      await tx.insert(scheduleBlockMembers).values({ organizationId, blockId: row.id, memberId: need(refs.idBySlug.members, slug, "team member")! });
    }
  }

  // The counters continue after what was seeded (BK-1043 after BK-1042, JB-205 after JB-204), and start at 1001 for a business with none.
  const next = (kind: "booking" | "job", references: readonly string[], prefix: "BK" | "JB") => ({
    organizationId,
    kind,
    nextValue: references.length > 0 ? highest(references, prefix) + 1 : 1001,
  });
  await tx
    .insert(organizationSequences)
    .values([next("booking", data.bookings.map((booking) => booking.id), "BK"), next("job", data.jobs.map((job) => job.id), "JB")])
    .onConflictDoUpdate({ target: [organizationSequences.organizationId, organizationSequences.kind], set: { nextValue: sql`excluded.next_value`, updatedAt: sql`now()` } });
}

/** Remove every operational record of one organization (tests reset a worker's copy of the sample business with this). */
export async function clearOperations(tx: Tx, organizationId: string): Promise<void> {
  // Jobs before bookings (a job points at its booking); files and block members go with their parents.
  await tx.delete(jobs).where(eq(jobs.organizationId, organizationId));
  await tx.delete(bookings).where(eq(bookings.organizationId, organizationId));
  await tx.delete(scheduleBlocks).where(eq(scheduleBlocks.organizationId, organizationId));
  await tx.delete(organizationSequences).where(eq(organizationSequences.organizationId, organizationId));
}
