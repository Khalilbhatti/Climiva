"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck,
  CircleCheck,
  Circle,
  Clock,
  CloudUpload,
  Eye,
  FilePenLine,
  Globe,
  LayoutTemplate,
  Layers,
  Plus,
  Rocket,
  Store,
  SquareArrowOutUpRight,
  EyeOff,
  Info,
} from "lucide-react";
import { useBrandStyle, useHoursRows, useSettings } from "@/components/settings/SettingsProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WEEK_ORDER } from "@/data/settings";
import { getShownServices, getPrimaryDomain, hasUnpublishedChanges, WEBSITE_PAGES, CLIMVIA_DOMAIN } from "@/data/website";
import { previewHref } from "./site-links";
import { SiteFooter, SiteHeader, SiteRenderer } from "./SiteRenderer";
import { BrowserFrame, SiteStatusBadge, usePublishing } from "./site-ui";
import { useWebsite } from "./WebsiteProvider";
import { useServices } from "@/components/services/ServicesProvider";

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={cardClasses("lg")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const rowLink = "inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline";

export function WebsiteOverview() {
  const { site } = useWebsite();
  const { settings } = useSettings();
  const brandStyle = useBrandStyle();
  const business = settings.business;
  const hours = useHoursRows();
  const { publishNow, askUnpublish, unpublishModal } = usePublishing();
  const empty = useSearchParams().get("state") === "empty";
  const { services: catalog } = useServices();

  if (empty) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={LayoutTemplate}
          title="No website created yet"
          description="Create a simple public website for your business with Services, contact information, and online booking."
          action={
            <ButtonLink href="/website" size="lg">
              <Plus aria-hidden className="size-4" />
              Create website
            </ButtonLink>
          }
        />
        <div className="flex items-start gap-3 rounded-card bg-surface-low p-4">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-ink">Uses your existing business setup</p>
            <p className="text-sm text-ink-muted">
              Your Website uses the business information, Services, hours, and booking settings already configured in Climvia.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const content = site.published ? site.live : site.draft;
  const shown = getShownServices(content.services, catalog);
  const bookable = shown.filter((service) => service.visibility === "public-booking");
  const primary = getPrimaryDomain(site.domain);
  const pending = hasUnpublishedChanges(site);

  const checklist = [
    { label: "Business information", done: true },
    { label: "Services", done: shown.length > 0 },
    { label: "Business hours", done: WEEK_ORDER.some((day) => settings.hours[day]) },
    { label: "Booking experience", done: bookable.length > 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Website status"
          value={site.published ? "Published" : "Private"}
          icon={site.published ? CloudUpload : EyeOff}
          hint={site.published ? `Live at ${primary}` : "Preview link accessible"}
          hintDot={site.published}
        />
        <KpiCard
          label="Pages"
          value={`${WEBSITE_PAGES.length} pages`}
          icon={Layers}
          hint="Home, Services, About, Contact, Booking"
          href="/website/pages"
        />
        <KpiCard
          label="Services shown"
          value={`${shown.length} ${shown.length === 1 ? "Service" : "Services"}`}
          icon={Store}
          hint="Linked to your Service catalog"
          href="/services"
        />
        <KpiCard
          label="Online booking"
          value={bookable.length > 0 ? "Enabled" : "Off"}
          icon={CalendarCheck}
          hint={`${bookable.length} ${bookable.length === 1 ? "Service" : "Services"} can be booked or requested online`}
          href="/website/booking"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-7">
          <Card
            title="Customer-facing preview"
            aside={<span className="text-xs text-ink-muted">{site.published ? "Live website" : "Draft · not published"}</span>}
          >
            <BrowserFrame address={`https://${primary}`} note={site.published ? "Live" : "Private"}>
              <div inert style={brandStyle} className="@container h-80 overflow-hidden bg-surface">
                <SiteHeader />
                <SiteRenderer page="home" content={content} embedded />
                <SiteFooter />
              </div>
            </BrowserFrame>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-muted">Rendered from your saved pages and your Services catalog.</p>
              <div className="flex gap-2">
                <ButtonLink href="/website/pages" variant="secondary" size="sm">
                  <FilePenLine aria-hidden className="size-3.5" />
                  Edit website
                </ButtonLink>
                <ButtonLink href={previewHref("home", site.published)} size="sm">
                  <Eye aria-hidden className="size-3.5" />
                  {site.published ? "View live website" : "Preview website"}
                </ButtonLink>
              </div>
            </div>
          </Card>

          <Card title="Connected business content">
            <p className="mb-3 text-sm text-ink-muted">This website uses information already configured in Climvia.</p>
            <ul className="space-y-2">
              {[
                {
                  title: "Business information",
                  detail: `${business.name} · ${business.address.city}, ${business.address.state}`,
                  action: "Edit source",
                  href: "/settings" as const,
                },
                {
                  title: "Services",
                  detail: `${shown.length} ${shown.length === 1 ? "Service" : "Services"} linked from your Service catalog`,
                  action: "Manage",
                  href: "/services" as const,
                },
                {
                  title: "Business hours",
                  detail: hours.map((row) => `${row.days} ${row.hours}`).join(" · "),
                  action: "Edit source",
                  href: "/settings" as const,
                },
                {
                  title: "Booking settings",
                  detail: "Each Service sets how customers book it: instantly, by request, or by quote",
                  action: "Manage",
                  href: "/services" as const,
                },
              ].map((row) => (
                <li key={row.title} className="flex items-center justify-between gap-4 rounded-btn bg-surface-low px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{row.title}</p>
                    <p className="truncate text-xs text-ink-muted">{row.detail}</p>
                  </div>
                  <Link href={row.href} className={rowLink}>
                    {row.action}
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-5">
          <Card title="Publishing" aside={<SiteStatusBadge published={site.published} />}>
            {site.published ? (
              <>
                <p className="text-sm text-ink-muted">
                  Your website is live and open to visitors. Customers can view your services and book appointments.
                </p>
                {pending && (
                  <p className="mt-3 flex items-start gap-2 rounded-btn bg-warning-soft px-3 py-2 text-xs text-warning">
                    <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    You have saved changes that are not live yet.
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  {pending && (
                    <Button className="w-full" onClick={publishNow}>
                      <Rocket aria-hidden className="size-4" />
                      Publish changes
                    </Button>
                  )}
                  <ButtonLink href={previewHref("home", true)} variant="secondary" className="w-full">
                    View live website
                    <SquareArrowOutUpRight aria-hidden className="size-4" />
                  </ButtonLink>
                  <Button variant="secondary" className="w-full" onClick={askUnpublish}>
                    <EyeOff aria-hidden className="size-4" />
                    Unpublish
                  </Button>
                </div>
                <p className="mt-3 text-xs text-ink-muted">
                  Unpublishing makes the website private without deleting any pages or content.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  Your website is ready to preview. Publish it when you are satisfied with the content and booking setup.
                </p>
                <Button className="mt-4 w-full" onClick={publishNow}>
                  <Rocket aria-hidden className="size-4" />
                  Publish website
                </Button>
                <p className="mt-3 rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">
                  Publishing makes the website accessible to customers at <strong className="text-ink">{CLIMVIA_DOMAIN}</strong>
                  {site.domain.custom ? <> and {site.domain.custom}</> : null}. Publishing does not change your Bookings, Services,
                  Customers, Jobs, Invoices, or Payments.
                </p>
              </>
            )}
          </Card>

          <Card title="Website address" aside={<Globe aria-hidden className="size-5 text-ink-muted" />}>
            <ul className="space-y-2">
              <li className="rounded-btn bg-surface-low px-4 py-3">
                <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">Climvia address</p>
                <div className="mt-0.5 flex items-center justify-between gap-3">
                  <p className="font-mono text-sm font-semibold text-ink">{CLIMVIA_DOMAIN}</p>
                  {site.domain.primary === "climvia" && <StatusBadge tone="positive">Primary</StatusBadge>}
                </div>
              </li>
              {site.domain.custom && (
                <li className="rounded-btn bg-surface-low px-4 py-3">
                  <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">Custom domain</p>
                  <div className="mt-0.5 flex items-center justify-between gap-3">
                    <p className="font-mono text-sm font-semibold text-ink">{site.domain.custom}</p>
                    {site.domain.primary === "custom" ? <StatusBadge tone="positive">Primary</StatusBadge> : <StatusBadge tone="primary">Connected</StatusBadge>}
                  </div>
                </li>
              )}
            </ul>
            <Link href="/website/domain" className={`${rowLink} mt-3`}>
              {site.domain.custom ? "Manage domain" : "Connect custom domain"}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </Card>

          <Card title="Website checklist">
            <p className="mb-3 text-sm text-ink-muted">Items your public presence already uses.</p>
            <ul className="space-y-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3 rounded-btn bg-surface-low px-3 py-2 text-sm text-ink">
                  <span className="flex items-center gap-2">
                    {item.done ? <CircleCheck aria-hidden className="size-4 text-positive" /> : <Circle aria-hidden className="size-4 text-ink-faint" />}
                    {item.label}
                  </span>
                  <span className="text-xs font-semibold text-ink-muted">{item.done ? "Complete" : "Needs attention"}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 rounded-btn bg-surface-low px-3 py-2 text-sm text-ink">
                <span className="flex items-center gap-2">
                  {site.domain.custom ? <CircleCheck aria-hidden className="size-4 text-positive" /> : <Circle aria-hidden className="size-4 text-ink-faint" />}
                  Custom domain
                </span>
                <span className="text-xs font-semibold text-ink-muted">{site.domain.custom ? "Connected" : "Optional"}</span>
              </li>
            </ul>
          </Card>

          <Card title="Online booking" aside={<StatusBadge tone={bookable.length > 0 ? "positive" : "neutral"}>{bookable.length > 0 ? "Enabled" : "Off"}</StatusBadge>}>
            <p className="text-sm text-ink-muted">
              Customers can book or request Services using the booking method set on each Service. Requests arrive in Bookings.
            </p>
            <Link href="/website/booking" className={`${rowLink} mt-3`}>
              Manage booking setup
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </Card>

        </div>
      </div>
      {unpublishModal}
    </div>
  );
}
