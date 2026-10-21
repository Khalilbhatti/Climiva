/**
 * What the Overview says about a business, worked out from its own records and nothing else: how far its setup has got, what is on today, what needs an
 * answer and what is coming up. Pure functions of the data the workspace already holds, so a number on the Overview can never differ from the page it links to,
 * and nothing is invented: a business with no bookings has no "today", and a step is done only when the thing it names exists.
 */
import type { Route } from "next";
import type { CoreSnapshot, Directory } from "@/data/directory";
import { getInvoiceStatus } from "@/data/financials";
import { getAssigneeName, getPartyName, getServiceNameFor, type Booking, type Job } from "@/data/operations";

/** The cookie that remembers, in this browser, that the owner hid the Getting started checklist for this business. */
export const gettingStartedCookie = (organizationId: string) => `getting_started_dismissed_${organizationId}`;

export type SetupStepId = "service" | "team" | "website" | "marketplace" | "customer";
export type SetupStep = { id: SetupStepId; title: string; text: string; href: Route; done: boolean };
export type SetupState = { steps: SetupStep[]; completed: number; total: number; complete: boolean };

/**
 * The five things a new business does first. Each is complete when the thing it names exists, never because the person clicked it:
 * a Service in the catalog, a second person on the team (the owner is the first), a published website, a published Marketplace Listing, and a customer or a booking.
 */
export function setupState(core: Pick<CoreSnapshot, "services" | "team" | "website" | "marketplace" | "book" | "operations">): SetupState {
  const steps: SetupStep[] = [
    { id: "service", title: "Add your first service", text: "What you offer, how long it takes, what it costs and how customers book it.", href: "/services?new=1", done: core.services.length > 0 },
    { id: "team", title: "Add your team", text: "The people who do the work, and what each of them can do.", href: "/team", done: core.team.members.length > 1 },
    { id: "website", title: "Customize and publish your website", text: "Your website stays private until you publish it.", href: "/website", done: core.website?.published === true },
    { id: "marketplace", title: "Publish your Marketplace Listing", text: "Choose the services and places homeowners can find you for.", href: "/marketplace-listing", done: core.marketplace.status === "published" },
    {
      id: "customer",
      title: "Add your first customer",
      text: "Add someone you serve. A customer also appears when someone books with you.",
      href: "/customers?new=1",
      done: core.book.customers.length > 0 || core.operations.bookings.length > 0,
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  return { steps, completed, total: steps.length, complete: completed === steps.length };
}

export type AgendaItem = { key: string; kind: "Booking" | "Job"; start: string; end: string; who: string; service: string; assignee?: string; status: string; href: Route };

const startOrder = (a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start);
const bookingHref = (booking: Booking): Route => `/bookings?tab=${booking.status === "pending" ? "requests" : "upcoming"}&booking=${booking.id}` as Route;

/**
 * What is on today, in the order of the day: the Jobs scheduled for today and the Bookings for today that have not become a Job. (A Booking that already has a Job
 * is the Job's business: it is listed once, as the Job.) A cancelled Booking is not on anyone's day.
 */
export function todaysAgenda(core: Pick<CoreSnapshot, "operations" | "book" | "services" | "team">, today: string): AgendaItem[] {
  const dir: Directory = { ...core.book, services: core.services, team: core.team };
  const jobs: AgendaItem[] = core.operations.jobs
    .filter((job) => job.date === today)
    .map((job) => ({ key: job.id, kind: "Job" as const, start: job.start, end: job.end, who: getPartyName(job, dir), service: getServiceNameFor(job, dir), assignee: getAssigneeName(job, dir), status: job.status === "in-progress" ? "In progress" : job.status === "completed" ? "Completed" : "Scheduled", href: `/jobs/${job.id}` as Route }));
  const jobBookings = new Set(core.operations.jobs.map((job) => job.bookingId).filter(Boolean));
  const bookings: AgendaItem[] = core.operations.bookings
    .filter((booking) => booking.date === today && (booking.status === "pending" || booking.status === "confirmed") && !jobBookings.has(booking.id) && !booking.jobId)
    .map((booking) => ({ key: booking.id, kind: "Booking" as const, start: booking.start, end: booking.end, who: getPartyName(booking, dir), service: getServiceNameFor(booking, dir), assignee: getAssigneeName(booking, dir), status: booking.status === "pending" ? "Waiting for your answer" : "Confirmed", href: bookingHref(booking) }));
  return [...jobs, ...bookings].sort(startOrder);
}

export type AttentionItem = { key: string; count: number; text: string; href: Route };

/**
 * What needs the owner to do something, each with the page where they do it. Only what is real and not zero is listed: a business that is up to date has an
 * empty list, which the page says in words.
 */
export function needsAttention(core: Pick<CoreSnapshot, "operations" | "financials" | "reviews" | "team">, today: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  const requests = core.operations.bookings.filter((booking) => booking.status === "pending").length;
  if (requests > 0) items.push({ key: "requests", count: requests, text: requests === 1 ? "booking request is waiting for your answer" : "booking requests are waiting for your answer", href: "/bookings?tab=requests" });
  const unassigned = core.team.members.length > 0 ? core.operations.bookings.filter((booking) => booking.status === "confirmed" && booking.date >= today && !booking.assigneeId).length : 0;
  if (unassigned > 0) items.push({ key: "unassigned", count: unassigned, text: unassigned === 1 ? "confirmed booking has no technician yet" : "confirmed bookings have no technician yet", href: "/bookings?tab=upcoming" });
  const unpaid = core.financials.invoices.filter((invoice) => getInvoiceStatus(invoice, core.financials) !== "paid").length;
  if (unpaid > 0) items.push({ key: "unpaid", count: unpaid, text: unpaid === 1 ? "invoice has not been paid in full" : "invoices have not been paid in full", href: "/quotes-invoices?tab=invoices" });
  const unanswered = core.reviews.reviews.filter((review) => !review.response).length;
  if (unanswered > 0) items.push({ key: "reviews", count: unanswered, text: unanswered === 1 ? "review has no reply from you" : "reviews have no reply from you", href: "/reviews?tab=awaiting" });
  return items;
}

/** The next few Bookings after today (a request or a confirmed one), soonest first. Today's are in the day's agenda. */
export function upcomingBookings(core: Pick<CoreSnapshot, "operations">, today: string, limit = 5): Booking[] {
  return core.operations.bookings
    .filter((booking) => (booking.status === "pending" || booking.status === "confirmed") && booking.date > today)
    .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`))
    .slice(0, limit);
}

/** Jobs that are being worked on right now. */
export function activeJobs(core: Pick<CoreSnapshot, "operations">, limit = 5): Job[] {
  return core.operations.jobs.filter((job) => job.status === "in-progress").slice(0, limit);
}

/** Whether the business has done anything yet: until it has, the Overview is about setting up and shows no empty "today". */
export const hasActivity = (core: Pick<CoreSnapshot, "operations">) => core.operations.bookings.length > 0 || core.operations.jobs.length > 0;
