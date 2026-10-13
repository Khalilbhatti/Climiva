"use client";

import Link from "next/link";
import { ArrowRight, Globe, Mail, Phone, Store } from "lucide-react";
import { useBusiness, useHoursRows } from "@/components/settings/SettingsProvider";
import { cardClasses } from "@/components/ui/Card";
import { useSiteAddress } from "@/components/website/WebsiteProvider";
import { formatCityStateZip, toTelHref } from "@/lib/format";

const labelClasses = "text-xs font-medium tracking-wider text-ink-muted uppercase";

/**
 * Read-only view of the business record. The name, contact details, address and hours are the saved Settings (the
 * canonical record until something is edited there) and the website is the Website's primary address, so the only
 * action here is the link to Settings.
 */
export function BusinessInfoCard() {
  const business = useBusiness();
  const hours = useHoursRows();
  const address = useSiteAddress();
  return (
    <section aria-labelledby="business-info-heading" className={cardClasses("lg")}>
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
        <div className="flex min-h-7 items-center gap-2.5">
          <Store aria-hidden className="size-5 text-primary" />
          <h2 id="business-info-heading" className="text-xs font-bold tracking-wider text-primary uppercase">
            Business information
          </h2>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          Manage Settings
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 pt-5 md:grid-cols-3">
        <div>
          <h3 className={labelClasses}>Business Identity</h3>
          <p className="mt-1.5 text-base font-bold text-ink">{business.name}</p>
          <p className="mt-1 flex min-h-5 items-center gap-1.5 text-xs text-ink-muted">
            <Phone aria-hidden className="size-3.5" />
            <a href={toTelHref(business.phone)} className="hover:underline">
              {business.phone}
            </a>
          </p>
          <p className="mt-1 flex min-h-5 items-center gap-1.5 text-xs text-ink-muted">
            <Mail aria-hidden className="size-3.5" />
            <a href={`mailto:${business.email}`} className="hover:underline">
              {business.email}
            </a>
          </p>
        </div>

        <div>
          <h3 className={labelClasses}>Business Address</h3>
          <p className="mt-1.5 text-sm font-semibold text-ink">{business.address.street}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{formatCityStateZip(business.address)}</p>
          {address && (
            <p className="mt-2 flex min-h-5 items-center gap-1.5 text-xs text-ink-muted">
              <Globe aria-hidden className="size-3.5" />
              {address}
            </p>
          )}
        </div>

        <div>
          <h3 className={labelClasses}>Operating Hours</h3>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {hours.map(({ days, hours }, index) => (
              <li key={days} className={index === 0 ? "font-medium text-ink" : "text-ink-muted"}>
                {days}: {hours}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
