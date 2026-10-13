"use server";

import { headers } from "next/headers";
import { PROTOTYPE_NOW } from "@/lib/prototype-clock";
import { createPublicBooking, loadPublicSite } from "@/db/public-queries";
import { failure, ok, type ActionResult } from "@/lib/action-result";
import { businessClock, stampInstant } from "@/lib/business-time";
import {
  PUBLIC_BOOKING_BUSY,
  PUBLIC_BOOKING_UNAVAILABLE,
  bookingReferenceOf,
  checkPublicBooking,
  parsePublicBooking,
} from "@/lib/public-booking-rules";
import { clientAddress, withinLimit } from "../rate-limit";

/**
 * A booking made by a visitor from a published site's Booking page. There is no session and no workspace here, by design:
 *
 *   1. the request names a SITE (by its public identity) and a Service of that site's business; it never names an organization, and
 *      anything extra in it is ignored,
 *   2. the visitor's address is rate limited (a script cannot post the form in a loop),
 *   3. the site is looked up as a visitor sees it (published only); the business, its hours, its clock and its Services come from there,
 *   4. the Service must be one that business offers for online booking, the time one of its slots on a day it is open, and the answers
 *      among the Service's options (the same slots the Booking page shows),
 *   5. the database function finds the organization from the SITE again, checks the Service belongs to it, allocates the business's next
 *      number and writes one booking of source "Website" (a second submission with the same key, or the same person asking for the same
 *      Service at the same time, finds the first booking instead of making another).
 * The answer is only a reference, a status and whether it was a repeat: a visitor cannot read any booking record.
 */

type Answer = { reference: string; status: "pending" | "confirmed"; duplicate: boolean };

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_WINDOW = 12;

export async function submitPublicBookingAction(input: unknown): Promise<ActionResult<Answer>> {
  const parsed = parsePublicBooking(input);
  if (!parsed.ok) return failure(parsed.error, parsed.fields);
  const request = parsed.value;

  const address = clientAddress((await headers()).get("x-forwarded-for"));
  if (!withinLimit(`booking:${request.siteSlug}:${address}`, LIMIT_PER_WINDOW, WINDOW_MS)) return failure(PUBLIC_BOOKING_BUSY);

  try {
    const site = await loadPublicSite(request.siteSlug, "");
    if (!site) return failure(PUBLIC_BOOKING_UNAVAILABLE);
    const clock = businessClock(site.fixedClock, site.preferences.timeZone, PROTOTYPE_NOW);
    const checked = checkPublicBooking(request, site.services.find((service) => service.id === request.serviceSlug), site.hours, clock.today);
    if (!checked.ok) return failure(checked.error, checked.fields);

    const result = await createPublicBooking({
      platformSlug: request.siteSlug,
      serviceSlug: request.serviceSlug,
      submissionKey: request.submissionKey,
      date: request.date,
      start: request.start,
      end: request.end,
      name: request.name,
      phone: request.phone,
      email: request.email,
      address: request.address,
      note: checked.value.note,
      systemType: checked.value.systemType,
      reportedIssue: checked.value.reportedIssue,
      receivedAt: stampInstant(site.fixedClock, site.preferences.timeZone, PROTOTYPE_NOW),
    });
    if (!result.ok) return failure(result.reason === "details" ? "Check your details and try again." : result.reason === "service" ? "That service isn't available to book online." : PUBLIC_BOOKING_UNAVAILABLE);
    return ok({ reference: bookingReferenceOf(result.number), status: result.status, duplicate: result.duplicate });
  } catch (error) {
    // A database error is never shown to a visitor.
    console.error("[public booking] could not save:", error instanceof Error ? error.message : error);
    return failure("We couldn't send your request. Please try again, or call the business.");
  }
}
