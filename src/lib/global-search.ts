/**
 * The top-bar search: finds Customers, Jobs, Bookings and Schedule entries by what a person would type to look them
 * up, from the same records the modules show, so it follows whatever has happened this session. It owns no records
 * and builds no index; it is a pure function of the data it is given.
 */
import type { AppHref } from "@/config/routes";
import { CUSTOMERS, formatPropertyAddress, getPrimaryProperty, getPropertyById } from "@/data/customers";
import {
  BOOKING_STATUS_LABEL,
  JOB_STATUS_LABEL,
  getAssigneeName,
  getPartyName,
  getScheduleEvents,
  getServiceNameFor,
  type OperationsData,
} from "@/data/operations";
import { formatMonthDay, formatTimeRange, formatWeekdayDate } from "./dates";

export const SEARCH_GROUPS = ["Customers", "Jobs", "Bookings", "Schedule"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export type SearchResult = { id: string; group: SearchGroup; title: string; detail: string; href: AppHref };

/** Fewer characters than this finds too much to be of use, so nothing is searched. */
export const MIN_QUERY = 2;
/** How many results each group shows. */
export const PER_GROUP = 4;

const digits = (value: string) => value.replace(/\D/g, "");

/** Every word typed must be found somewhere in the record's text; "#" is ignored so "#JB-204" and "JB-204" are the same. */
function tokens(query: string): string[] {
  return query.toLowerCase().replace(/#/g, " ").split(/\s+/).filter(Boolean);
}

const matches = (haystack: string, words: string[]) => words.every((word) => haystack.includes(word));

export function searchWorkspace(query: string, data: OperationsData): SearchResult[] {
  if (query.trim().length < MIN_QUERY) return [];
  const words = tokens(query);
  if (words.length === 0) return [];

  const customers: SearchResult[] = [];
  for (const customer of CUSTOMERS) {
    const property = getPrimaryProperty(customer);
    const address = property ? formatPropertyAddress(property) : "";
    const haystack = [customer.name, customer.phone, digits(customer.phone), customer.email, address].join(" ").toLowerCase();
    if (matches(haystack, words)) {
      customers.push({ id: customer.id, group: "Customers", title: customer.name, detail: [property?.street, customer.phone].filter(Boolean).join(" · "), href: `/customers/${customer.id}` });
    }
  }

  const jobs: SearchResult[] = [];
  for (const job of data.jobs) {
    const party = getPartyName(job);
    const street = getPropertyById(job.propertyId ?? "")?.street ?? "";
    const haystack = [job.id, party, getServiceNameFor(job), street].join(" ").toLowerCase();
    if (matches(haystack, words)) {
      jobs.push({ id: job.id, group: "Jobs", title: `#${job.id} · ${party}`, detail: `${getServiceNameFor(job)} · ${formatMonthDay(job.date)} · ${JOB_STATUS_LABEL[job.status]}`, href: `/jobs/${job.id}` });
    }
  }

  const bookings: SearchResult[] = [];
  for (const booking of data.bookings) {
    const party = getPartyName(booking);
    const street = getPropertyById(booking.propertyId ?? "")?.street ?? "";
    const haystack = [booking.id, party, getServiceNameFor(booking), street].join(" ").toLowerCase();
    if (matches(haystack, words)) {
      bookings.push({ id: booking.id, group: "Bookings", title: `#${booking.id} · ${party}`, detail: `${getServiceNameFor(booking)} · ${formatMonthDay(booking.date)} · ${BOOKING_STATUS_LABEL[booking.status]}`, href: `/bookings?booking=${booking.id}` });
    }
  }

  // The schedule is searched by technician, by day and by blocked time; people and work are found in the groups above.
  const schedule: SearchResult[] = [];
  for (const event of getScheduleEvents(data)) {
    const who = event.kind === "work" ? getAssigneeName(event) ?? "" : event.title;
    const haystack = [who, formatWeekdayDate(event.date), formatMonthDay(event.date), event.date].join(" ").toLowerCase();
    if (!matches(haystack, words)) continue;
    const what = event.kind === "work" ? `${getPartyName(event)} · ${getServiceNameFor(event)}` : event.title;
    schedule.push({
      id: event.id,
      group: "Schedule",
      title: `${formatWeekdayDate(event.date)} · ${formatTimeRange(event.start, event.end)}`,
      detail: event.kind === "work" && who ? `${who} · ${what}` : what,
      href: `/schedule?view=day&date=${event.date}&event=${event.id}`,
    });
  }
  schedule.sort((a, b) => a.href.localeCompare(b.href));

  return [customers, jobs, bookings, schedule].flatMap((group) => group.slice(0, PER_GROUP));
}
