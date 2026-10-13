"use client";

import { useRef } from "react";
import type { AppHref } from "@/config/routes";
import type { Service } from "@/data/services";
import type { WeeklyHours } from "@/data/settings";
import { send } from "@/lib/send-action";
import { submitPublicBookingAction } from "@/server/actions/public-booking";
import { BookingJourney, type JourneyResult, type JourneySubmission } from "../BookingJourney";
import type { SiteView } from "../site-view";

/**
 * A random key for one journey. `crypto.randomUUID` exists only on secure origins (https, and localhost); a visitor can arrive on another
 * (a staging address over http, or a customer's domain before its certificate is in place), and the key only has to be unique and unguessable,
 * so random bytes will do where the UUID function is missing.
 */
function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A booking journey on the published site. It sends the visitor's request to the public booking action: the site's public address, the
 * Service's slug, a random key for this journey (so a double click or a retry is one booking) and what the visitor typed. It names no
 * organization; the server finds the business from the site.
 */
export function PublicBooking({
  siteSlug,
  view,
  service,
  hours,
  today,
  bookingHref,
  homeHref,
}: {
  siteSlug: string;
  view: SiteView;
  service: Service | undefined;
  hours: WeeklyHours;
  today: string;
  bookingHref: AppHref;
  homeHref: AppHref;
}) {
  // One key per journey, made when the visitor first confirms and kept for retries.
  const key = useRef<string>(undefined);

  async function submit(s: JourneySubmission): Promise<JourneyResult> {
    key.current ??= newSubmissionKey();
    const result = await send(() =>
      submitPublicBookingAction({
        siteSlug,
        serviceSlug: s.service.id,
        submissionKey: key.current,
        date: s.date,
        start: s.start,
        end: s.end,
        name: s.name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        notes: s.notes,
        answers: s.answers,
      }),
    );
    return result.ok ? { ok: true, reference: result.data.reference } : { ok: false, error: result.error, fields: result.fields };
  }

  return <BookingJourney service={service} view={view} hours={hours} today={today} submit={submit} bookingHref={bookingHref} homeHref={homeHref} />;
}
