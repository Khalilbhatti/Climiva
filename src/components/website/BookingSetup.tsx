"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import {
  BOOKING_METHOD_ARRIVAL,
  BOOKING_METHOD_DETAIL,
  BOOKING_METHOD_LABEL,
  formatDuration,
  formatServicePrice,
} from "@/data/services";
import { getShownServices } from "@/data/website";
import { previewHref } from "./site-links";
import { useWebsite } from "./WebsiteProvider";

/**
 * Booking tab: what a customer can do on the website, read from the Services catalog. This is a view, not a
 * second place to configure booking: each Service owns its own booking method.
 */
export function BookingSetup() {
  const { site } = useWebsite();
  const shown = getShownServices((site.published ? site.live : site.draft).services);
  const online = shown.filter((service) => service.visibility === "public-booking");

  return (
    <div className="space-y-6">
      <section aria-labelledby="online-booking-heading" className={cardClasses("lg")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-primary-subtle text-primary">
              <CalendarCheck className="size-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="online-booking-heading" className="text-base font-semibold text-ink">
                  Online booking
                </h2>
                <StatusBadge tone={online.length > 0 ? "positive" : "neutral"}>{online.length > 0 ? "Enabled" : "Off"}</StatusBadge>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                Customers book or request each Service the way that Service is set up. Requests and bookings made on the website arrive in{" "}
                <Link href="/bookings" className="font-semibold text-primary hover:underline">
                  Bookings
                </Link>
                ; no job, quote, invoice or payment is created until the work itself starts.
              </p>
            </div>
          </div>
          <ButtonLink href={previewHref("booking")} variant="secondary">
            Preview booking page
          </ButtonLink>
        </div>
      </section>

      <section aria-labelledby="methods-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="methods-heading" className="text-base font-semibold text-ink">
            Booking method by Service
          </h2>
          <Link href="/services" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Manage Services
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
        {shown.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No Services are shown on the website, so there is nothing to book online.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Service</TableHeaderCell>
                <TableHeaderCell>Booking method</TableHeaderCell>
                <TableHeaderCell>Customer chooses</TableHeaderCell>
                <TableHeaderCell>Price</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Preview</span>
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {shown.map((service) => (
                <TableRow key={service.id}>
                  <TableCell>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-xs text-ink-muted">{formatDuration(service.durationMinutes)}</p>
                  </TableCell>
                  <TableCell>
                    <p>{BOOKING_METHOD_LABEL[service.bookingMethod]}</p>
                    <p className="max-w-xs text-xs text-ink-muted">{BOOKING_METHOD_DETAIL[service.bookingMethod]}</p>
                  </TableCell>
                  <TableCell className="text-ink-muted">{BOOKING_METHOD_ARRIVAL[service.bookingMethod]}</TableCell>
                  <TableCell>{formatServicePrice(service.pricing)}</TableCell>
                  <TableCell className="text-right">
                    <ButtonLink
                      href={previewHref(`booking/${service.id}`)}
                      variant="tertiary"
                      size="sm"
                      aria-label={`Preview booking for ${service.name}`}
                    >
                      Preview
                    </ButtonLink>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
