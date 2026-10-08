"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck, Clock, Globe, Mail, MapPin, MessageSquare, Phone, Snowflake, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/settings/BrandMark";
import { useBrandStyle, useBusiness, useHoursRows } from "@/components/settings/SettingsProvider";
import { buttonClasses } from "@/components/ui/Button";
import { formatCityStateZip } from "@/data/fixtures";
import type { AppHref } from "@/config/routes";
import { getListingServices, type CoverId, type ListingConfig } from "@/data/marketplace";
import { BOOKING_METHOD_ACTION, formatDuration, formatServicePrice } from "@/data/services";
import { cn } from "@/lib/cn";
import { toTelHref } from "@/lib/format";

const COVER_CLASS: Record<CoverId, string> = {
  "teal-horizon": "bg-gradient-to-br from-primary via-primary to-primary-hover text-white/25",
  "warm-linen": "bg-gradient-to-br from-surface-low via-primary-subtle to-surface-low text-primary/20",
  "cool-slate": "bg-gradient-to-br from-ink-muted via-ink-muted to-ink text-white/20",
};

/** A cover is a reference to one of these CSS treatments: there is no image upload. */
export function CoverArt({ cover, className }: { cover?: CoverId; className?: string }) {
  if (!cover) return null;
  return (
    <div aria-hidden className={cn("relative overflow-hidden", COVER_CLASS[cover], className)}>
      <Snowflake className="absolute -right-6 -bottom-8 size-44" strokeWidth={1} />
      <span className="absolute -top-16 -left-10 size-48 rounded-full bg-white/10" />
    </div>
  );
}

type ListingViewProps = {
  config: ListingConfig;
  /** The Website's primary address, shown as the website when enabled. */
  domain: string;
  /**
   * "card" is the picture of the listing inside the workspace: nothing in it is a working link.
   * "page" is the public directory page, whose buttons lead to the website's real pages.
   */
  variant: "card" | "page";
  className?: string;
};

/** A real link on the public page; just the look of one in the picture of the listing inside the workspace. */
function ActionLink({ live, href, className, children }: { live: boolean; href: AppHref; className: string; children: ReactNode }) {
  return live ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

/**
 * One business's listing as the directory shows it. Everything except the description, the cover, the Service choice
 * and order, and what is switched on comes from the Business fixture, the Website's address and the Services catalog.
 */
export function ListingView({ config, domain, variant, className }: ListingViewProps) {
  const business = useBusiness();
  const brandStyle = useBrandStyle();
  const hoursLines = useHoursRows().map((row) => `${row.days} ${row.hours}`);
  const services = getListingServices(config);
  const page = variant === "page";
  // On the public directory page the business name is the page's heading; the picture inside the workspace sits under its own.
  const Name: "h1" | "h2" = page ? "h1" : "h2";
  const ServicesTitle: "h2" | "h3" = page ? "h2" : "h3";
  const contactRows = [
    config.contact.phone && { icon: Phone, label: "Phone", value: <a href={toTelHref(business.phone)} className="hover:underline">{business.phone}</a> },
    config.contact.email && { icon: Mail, label: "Email", value: <a href={`mailto:${business.email}`} className="break-all hover:underline">{business.email}</a> },
    config.contact.website && { icon: Globe, label: "Website", value: <span className="break-all">{domain}</span> },
    config.contact.address && {
      icon: MapPin,
      label: "Address",
      value: (
        <>
          {business.address.street}, {formatCityStateZip(business.address)}
        </>
      ),
    },
    config.contact.hours && {
      icon: Clock,
      label: "Hours",
      value: (
        <>
          {hoursLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </>
      ),
    },
  ].filter(Boolean) as { icon: LucideIcon; label: string; value: ReactNode }[];

  const actions = [
    config.actions.book && { icon: CalendarCheck, label: "Book service", href: "/website/preview/booking", primary: true },
    config.actions.website && { icon: Globe, label: "View website", href: "/website/preview", primary: false },
    config.actions.contact && { icon: MessageSquare, label: "Contact business", href: "/website/preview/contact", primary: false },
  ].filter(Boolean) as { icon: LucideIcon; label: string; href: AppHref; primary: boolean }[];

  return (
    <article aria-label={`${business.name} listing`} style={brandStyle} className={cn("@container overflow-hidden rounded-card border border-line bg-surface", className)}>
      <CoverArt cover={config.cover} className={page ? "h-40 @2xl:h-56" : "h-28"} />
      <div className="space-y-5 p-5 @2xl:p-6">
        <header className="flex items-start gap-4">
          <BrandMark className="size-12 rounded-card" crest={<Snowflake className="size-6" />} />
          <div className="min-w-0">
            <Name className="text-lg font-bold tracking-tight text-ink @2xl:text-xl">{business.name}</Name>
            {config.contact.address && (
              <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-muted">
                <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {business.address.street}, {formatCityStateZip(business.address)}
              </p>
            )}
            <p className="mt-2 text-sm text-ink">{config.description}</p>
          </div>
        </header>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <ActionLink
                key={action.label}
                live={page}
                href={action.href}
                className={buttonClasses({ variant: action.primary ? "primary" : "secondary", size: "md" })}
              >
                <action.icon aria-hidden className="size-4" />
                {action.label}
              </ActionLink>
            ))}
          </div>
        )}

        {contactRows.length > 0 && (
          <dl className="grid grid-cols-1 gap-3 rounded-card bg-surface-low p-4 @xl:grid-cols-2">
            {contactRows.map((row) => (
              <div key={row.label} className="flex items-start gap-2.5">
                <row.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 text-sm">
                  <dt className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{row.label}</dt>
                  <dd className="text-ink">{row.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        )}

        <section aria-label="Services">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <ServicesTitle className="text-sm font-bold text-ink">Services</ServicesTitle>
            <p className="text-xs text-ink-muted">
              {services.length} {services.length === 1 ? "service" : "services"} available for online scheduling and appointment requests
            </p>
          </div>
          {services.length === 0 ? (
            <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No Services are shown on this listing.</p>
          ) : (
            <ul className="space-y-3">
              {services.map((service) => (
                <li key={service.id} className="flex flex-col gap-3 rounded-card border border-line p-4 @xl:flex-row @xl:items-center @xl:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{service.name}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{service.description}</p>
                    <p className="mt-1.5 text-xs font-medium text-ink">
                      {formatServicePrice(service.pricing)} · {formatDuration(service.durationMinutes)}
                    </p>
                  </div>
                  <ActionLink
                    live={page}
                    href={`/website/preview/booking/${service.id}`}
                    className={buttonClasses({ variant: "secondary", size: "sm", className: "shrink-0 self-start @xl:self-center" })}
                  >
                    {BOOKING_METHOD_ACTION[service.bookingMethod]}
                  </ActionLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  );
}
