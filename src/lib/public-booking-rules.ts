/**
 * What a visitor may ask a published site's Booking page to do, and the checks that stand between the request and the database.
 *
 * A public booking request is anonymous: it names a site (by its public identity), a Service of that site's business (by its slug), a
 * time and the visitor's contact details. It NEVER names an organization: the server finds the business from the site, and the database
 * function does it again. Everything here is pure; the server action (src/server/actions/public-booking) calls it before it touches the
 * database, and the specs call it directly.
 */
import type { Service } from "@/data/services";
import type { WeeklyHours } from "@/data/settings";
import { getSlotGroup } from "./booking-slots";
import { isValidDate } from "./dates";
import { textProblem } from "./site-sections";
import { isRecord } from "./validation";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PUBLIC_BOOKING_UNAVAILABLE = "This website isn't taking bookings right now.";
export const PUBLIC_BOOKING_SERVICE = "That service isn't available to book online.";
export const PUBLIC_BOOKING_BUSY = "Too many requests from your connection. Please wait a few minutes and try again.";

export type PublicBookingRequest = {
  siteSlug: string;
  serviceSlug: string;
  submissionKey: string;
  date: string;
  start: string;
  end: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
  /** The answers to the Service's single-select intake questions, by question id. */
  answers: Record<string, string>;
};

export type ParsedRequest = { ok: true; value: PublicBookingRequest } | { ok: false; error: string; fields?: Record<string, string> };

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

function plain(value: unknown, min: number, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max && textProblem(trimmed) === undefined ? trimmed : undefined;
}

/** The shape of a request: every field present, of the right kind and size. Nothing about the site, the Service or the time is decided yet. */
export function parsePublicBooking(input: unknown): ParsedRequest {
  if (!isRecord(input)) return fail("The booking details were not understood.");
  const siteSlug = typeof input.siteSlug === "string" && input.siteSlug.length <= 63 && SLUG.test(input.siteSlug) ? input.siteSlug : undefined;
  const serviceSlug = typeof input.serviceSlug === "string" && input.serviceSlug.length <= 80 && SLUG.test(input.serviceSlug) ? input.serviceSlug : undefined;
  const submissionKey = typeof input.submissionKey === "string" && KEY.test(input.submissionKey) ? input.submissionKey : undefined;
  const date = typeof input.date === "string" && isValidDate(input.date) ? input.date : undefined;
  const start = typeof input.start === "string" && CLOCK.test(input.start) ? input.start : undefined;
  const end = typeof input.end === "string" && CLOCK.test(input.end) ? input.end : undefined;
  if (!siteSlug || !serviceSlug || !submissionKey || !date || !start || !end) return fail("The booking details were not understood.");

  const fields: Record<string, string> = {};
  const name = plain(input.name, 1, 80);
  if (!name) fields.name = "Enter your full name.";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (phone.length > 60 || phone.replace(/\D/g, "").length < 7 || textProblem(phone)) fields.phone = "Enter a phone number we can reach you on.";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email.length > 200 || !EMAIL.test(email)) fields.email = "Enter a valid email address.";
  const address = plain(input.address, 1, 300);
  if (!address) fields.address = "Enter the service address.";
  let notes: string | undefined;
  if (input.notes !== undefined && input.notes !== "") {
    notes = plain(input.notes, 1, 1000);
    if (!notes) fields.notes = "Keep the notes to plain text of 1,000 characters or fewer.";
  }
  const answers: Record<string, string> = {};
  if (input.answers !== undefined) {
    if (!isRecord(input.answers) || Object.keys(input.answers).length > 20) return fail("The booking details were not understood.");
    for (const [question, answer] of Object.entries(input.answers)) {
      if (typeof answer !== "string" || answer.length > 200 || question.length > 60) return fail("The booking details were not understood.");
      answers[question] = answer;
    }
  }
  if (Object.keys(fields).length > 0) return fail("Check the highlighted fields.", fields);
  return { ok: true, value: { siteSlug, serviceSlug, submissionKey, date, start, end, name: name!, phone, email, address: address!, notes, answers } };
}

export type CheckedBooking = {
  note?: string;
  systemType?: string;
  reportedIssue?: string;
};

/**
 * The request against the business: the Service must be one the business offers for online booking, the time must be one of that
 * Service's slots on a day the business is open and not in the past (the same slots the Booking page offers), and the answers must be
 * among the Service's options. Returns what to store, or the reason it is refused.
 */
export function checkPublicBooking(
  request: PublicBookingRequest,
  service: Service | undefined,
  hours: WeeklyHours,
  today: string,
): { ok: true; value: CheckedBooking } | { ok: false; error: string; fields?: Record<string, string> } {
  if (!service || service.visibility !== "public-booking" || !service.active) return fail(PUBLIC_BOOKING_SERVICE);

  const group = getSlotGroup(service.bookingMethod, request.date, service.durationMinutes, hours, today);
  const slot = group.slots.find((candidate) => candidate.start === request.start && candidate.end === request.end);
  if (group.unavailableReason) return fail(`${group.unavailableReason} Choose another date.`, { slot: group.unavailableReason });
  if (!slot || !slot.available) return fail("Select an available time.", { slot: "Select an available time." });

  const fields: Record<string, string> = {};
  const questions = service.intake.filter((question) => question.type === "single-select");
  for (const question of questions) {
    const answer = request.answers[question.id];
    if (answer === undefined || answer === "") {
      if (question.required) fields[`intake-${question.id}`] = "Select an option.";
    } else if (!question.options?.includes(answer)) {
      fields[`intake-${question.id}`] = "Select one of the options.";
    }
  }
  for (const id of Object.keys(request.answers)) if (!questions.some((question) => question.id === id)) fields[`intake-${id}`] = "That question isn't asked for this service.";
  if (Object.keys(fields).length > 0) return fail("Check the highlighted fields.", fields);

  const extras = questions
    .filter((question) => !["primary-issue", "system-type"].includes(question.id) && request.answers[question.id])
    .map((question) => `${question.prompt} ${request.answers[question.id]}`);
  const note = [request.notes, ...extras].filter(Boolean).join(" · ");
  return { ok: true, value: { note: note || undefined, systemType: request.answers["system-type"] || undefined, reportedIssue: request.answers["primary-issue"] || undefined } };
}

/** The reference a visitor is shown for a booking: its number, "BK-1043". */
export const bookingReferenceOf = (number: number) => `BK-${number}`;
