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
    key.current ??= crypto.randomUUID();
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
