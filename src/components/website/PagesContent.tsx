"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, FileText, Home, Info, Phone, Repeat, Store, type LucideIcon } from "lucide-react";
import { useBusiness, useHoursRows } from "@/components/settings/SettingsProvider";
import { useServices } from "@/components/services/ServicesProvider";
import { ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { formatCityStateZip } from "@/lib/format";
import { getPageStatus, getPrimaryDomain, getShownServices, orderedPages, pagePath, type PageType } from "@/data/website";
import { editorHref, previewHref } from "./site-links";
import { PageStatusBadge } from "./site-ui";
import { useWebsiteState } from "./WebsiteProvider";

const ICONS: Record<PageType, LucideIcon> = { home: Home, services: Store, content: Info, contact: Phone, booking: CalendarCheck };

/** Pages & content: the site's pages, each edited in its own editor. There is no page builder and no way to add a page here. */
export function PagesContent() {
  const website = useWebsiteState();
  const business = useBusiness();
  const hours = useHoursRows();
  const { services: catalog } = useServices();
  const pages = orderedPages(website.draft);
  const statuses = pages.map((page) => getPageStatus(website, page.key));
  const changed = statuses.filter((status) => status === "unpublished-changes").length;
  const summary = !website.published ? "Private" : changed > 0 ? `${changed} with unpublished changes` : `${pages.length} Published`;
  const shown = getShownServices(website.draft.settings.serviceDisplay, catalog);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="space-y-6 xl:col-span-7">
        <section aria-labelledby="pages-heading" className={cardClasses("lg")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="pages-heading" className="text-base font-semibold text-ink">
                Website pages
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {website.published ? "Pages currently available on " : "Pages that will be available on "}
                <span className="font-mono text-ink">{getPrimaryDomain(website.site, website.domain)}</span>
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-ink-muted">{summary}</span>
          </div>

          <ul className="mt-4 space-y-3">
            {pages.map((page) => {
              const Icon = ICONS[page.type] ?? FileText;
              return (
                <li key={page.key} className="flex flex-wrap items-center gap-4 rounded-card bg-surface-low p-4">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-surface text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {page.title} <span className="ml-1 font-mono text-xs font-normal text-ink-muted">{pagePath(page)}</span>
                    </p>
                    <div className="mt-1">
                      <PageStatusBadge status={getPageStatus(website, page.key)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ButtonLink href={previewHref(page.slug)} variant="tertiary" size="sm" aria-label={`Preview ${page.title} page`}>
                      Preview
                    </ButtonLink>
                    <ButtonLink href={editorHref(page.key)} variant="secondary" size="sm" aria-label={`Edit ${page.title} page`}>
                      Edit
                    </ButtonLink>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="lifecycle-heading" className="flex items-start gap-4 rounded-card bg-surface-low p-5">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-btn bg-surface text-primary">
            <Repeat className="size-4" />
          </span>
          <div>
            <h2 id="lifecycle-heading" className="text-sm font-semibold text-ink">
              Online booking lifecycle
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Customers submit booking requests on the website, which arrive in your Bookings module as pending requests or scheduled
              appointments. Jobs, Invoices, and Payments are created separately during job execution.
            </p>
          </div>
        </section>
      </div>

      <aside aria-labelledby="connected-heading" className={`${cardClasses("lg")} xl:col-span-5 xl:self-start`}>
        <h2 id="connected-heading" className="text-base font-semibold text-ink">
          Connected business content
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Changes to these records are reflected on the website without duplicating the information.
        </p>
        <dl className="mt-4 space-y-2">
          {[
            { term: "Business name", source: "Business information", value: business.name },
            { term: "Contact information", source: "Business information", value: `${business.phone} · ${business.email}` },
            { term: "Address", source: "Business information", value: `${business.address.street}, ${formatCityStateZip(business.address)}` },
            { term: "Business hours", source: "Business hours", value: hours.map((row) => `${row.days} ${row.hours}`).join(" · ") },
            { term: "Services", source: "Services", value: `${shown.length} active catalog ${shown.length === 1 ? "service" : "services"}` },
          ].map((row) => (
            <div key={row.term} className="rounded-btn bg-surface-low px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{row.term}</dt>
                <span className="text-xs text-ink-muted">{row.source}</span>
              </div>
              <dd className="mt-0.5 text-sm font-medium text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-btn bg-surface-low px-4 py-3 text-xs text-ink-muted">
          Editing these records in their own modules keeps your public website consistent without manual copy-pasting.
        </p>
        <div className="mt-3 flex gap-4 text-xs font-semibold">
          <Link href="/settings" className="inline-flex items-center gap-1 text-primary hover:underline">
            Business information
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
          <Link href="/services" className="inline-flex items-center gap-1 text-primary hover:underline">
            Services
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </aside>
    </div>
  );
}
