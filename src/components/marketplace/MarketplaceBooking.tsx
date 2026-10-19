"use client";

import { useRef } from "react";
import type { AppHref } from "@/config/routes";
import type { Service } from "@/data/services";
import type { WeeklyHours } from "@/data/settings";
import { send } from "@/lib/send-action";
import { submitMarketplaceBookingAction } from "@/server/actions/public-booking";
import { BookingJourney, type JourneyResult, type JourneySubmission } from "@/components/website/BookingJourney";

/** A random key for one journey (see PublicBooking): unique and unguessable, from random bytes where `crypto.randomUUID` does not exist. */
function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A booking journey on a provider's Marketplace profile. It sends the visitor's request to the Marketplace booking action: the listing's public
 * address, the Service's address, a random key for this journey (so a double click or a retry is one booking), what the visitor typed, and the
 * Service and place they were looking at on the results page (informational: the server keeps them only if they are addresses). It names no
 * organization, and it does not say where the booking came from: the server records that it came from the Marketplace.
 */
export function MarketplaceBooking({
  listingSlug,
  business,
  service,
  hours,
  today,
  profileHref,
  discoveryService,
  discoveryLocation,
}: {
  listingSlug: string;
  business: { name: string; phone: string };
  service: Service;
  hours: WeeklyHours;
  today: string;
  profileHref: AppHref;
  discoveryService: string | null;
  discoveryLocation: string | null;
}) {
  const key = useRef<string>(undefined);

  async function submit(s: JourneySubmission): Promise<JourneyResult> {
    key.current ??= newSubmissionKey();
    const result = await send(() =>
      submitMarketplaceBookingAction({
        listingSlug,
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
        discoveryService: discoveryService ?? undefined,
        discoveryLocation: discoveryLocation ?? undefined,
      }),
    );
    return result.ok ? { ok: true, reference: result.data.reference } : { ok: false, error: result.error, fields: result.fields };
  }

  return <BookingJourney service={service} view={{ business }} hours={hours} today={today} submit={submit} bookingHref={profileHref} homeHref={profileHref} />;
}
