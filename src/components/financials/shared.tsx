"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Mail, MapPin, Phone } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { Avatar } from "@/components/ui/Avatar";
import { SectionCard } from "@/components/ui/SectionCard";
import { customerHref, invoiceHref, jobHref, quoteHref } from "@/config/routes";
import { formatPropertyCityLine, getCustomerById, getPropertyById } from "@/data/customers";
import { BOOKING_TABS, getBookingById, getPartyName } from "@/data/operations";
import { getServiceById } from "@/data/services";
import { toTelHref, formatUSD } from "@/lib/format";

type Party = { customerId?: string; contactName?: string; propertyId?: string };

/** Money as shown on financial screens: always two decimals. */
export const usd = (amount: number) => formatUSD(amount, 2);

/** The customer's name, linked to their record when they have one. */
export function PartyName({ record }: { record: Party }) {
  const name = getPartyName(record);
  return record.customerId ? (
    <Link href={customerHref(record.customerId)} className="hover:underline">
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

/** Customer details for a record's side panel. People without a Customers record show their name only. */
export function CustomerCard({ record }: { record: Party }) {
  const name = getPartyName(record);
  const customer = record.customerId ? getCustomerById(record.customerId) : undefined;
  const property = getPropertyById(record.propertyId ?? customer?.propertyIds[0] ?? "");

  return (
    <SectionCard
      title="Customer"
      action={
        customer && (
          <Link href={customerHref(customer.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            View customer
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        )
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} size="lg" />
        <p className="text-sm font-semibold text-ink">{name}</p>
      </div>
      {customer ? (
        <ul className="mt-3 space-y-2 text-sm text-ink">
          <li className="flex items-center gap-2">
            <Phone aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <a href={toTelHref(customer.phone)} className="hover:underline">
              {customer.phone}
            </a>
          </li>
          <li className="flex items-center gap-2">
            <Mail aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <a href={`mailto:${customer.email}`} className="hover:underline">
              {customer.email}
            </a>
          </li>
          {property && (
            <li className="flex items-start gap-2">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              <span>
                {property.street}
                <span className="block text-xs text-ink-muted">
                  {formatPropertyCityLine(property)}
                  {property.area && ` (${property.area})`}
                </span>
              </span>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">No customer record yet.</p>
      )}
    </SectionCard>
  );
}

type RelatedProps = {
  quoteId?: string;
  invoiceId?: string;
  jobId?: string;
  bookingId?: string;
  serviceId?: string;
};

/** Links from a financial record to the quote, invoice, job, booking and service it relates to. */
export function RelatedRecords({ quoteId, invoiceId, jobId, bookingId, serviceId }: RelatedProps) {
  const { data } = useOperations();
  const booking = bookingId ? getBookingById(bookingId, data) : undefined;
  const bookingTab = BOOKING_TABS.find((tab) => tab.status === booking?.status)?.id ?? "upcoming";
  const service = serviceId ? getServiceById(serviceId) : undefined;

  const items: { label: string; link: ReactNode }[] = [];
  const add = (label: string, link: ReactNode) => items.push({ label, link });
  const linkClass = "flex items-center justify-between rounded-btn px-2 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-low";
  const arrow = <ArrowRight aria-hidden className="size-4 text-ink-muted" />;

  if (invoiceId) {
    add("Invoice", (
      <Link href={invoiceHref(invoiceId)} className={linkClass}>
        Invoice #{invoiceId}
        {arrow}
      </Link>
    ));
  }
  if (quoteId) {
    add("Quote", (
      <Link href={quoteHref(quoteId)} className={linkClass}>
        Quote #{quoteId}
        {arrow}
      </Link>
    ));
  }
  if (jobId) {
    add("Job", (
      <Link href={jobHref(jobId)} className={linkClass}>
        Job #{jobId}
        {arrow}
      </Link>
    ));
  }
  if (bookingId) {
    add("Booking", (
      <Link href={`/bookings?tab=${bookingTab}&booking=${bookingId}`} className={linkClass}>
        Booking #{bookingId}
        {arrow}
      </Link>
    ));
  }
  if (service) {
    add("Service", (
      <Link href={`/services/${service.id}`} className={linkClass}>
        {service.name}
        {arrow}
      </Link>
    ));
  }

  return (
    <SectionCard title="Related records">
      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">No related records.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.label}>{item.link}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
