"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck,
  CircleCheck,
  Circle,
  Clock,
  CloudUpload,
  Globe,
  LayoutTemplate,
  Layers,
  Plus,
  Store,
  EyeOff,
  Info,
} from "lucide-react";
import { useBrandStyle, useHoursRows, useSettings } from "@/components/settings/SettingsProvider";
import { useServices } from "@/components/services/ServicesProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { WEEK_ORDER } from "@/data/settings";
import { findPage, getPlatformAddress, getPrimaryAddress, getShownServices, hasUnpublishedChanges, orderedPages, primaryDomainOf, type VersionModel } from "@/data/website";
import { DOMAIN_STATUS_LABEL } from "@/lib/domain-rules";
import { DOMAIN_TONE } from "./domain-ui";
import { DEFAULT_THEME, themeAttributes, themeStyle } from "@/lib/site-theme";
import { PREVIEW_BASE } from "./site-links";
import { SiteFooter, SiteHeader, SiteRenderer } from "./SiteRenderer";
import { BrowserFrame, SiteStatusBadge, usePublishing } from "./site-ui";
import { useSiteView, useWebsite } from "./WebsiteProvider";

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

/** A version with nothing in it: what the hooks are given while the business has no website, so they can run unconditionally. */
const EMPTY_VERSION: VersionModel = {
  id: "",
  number: null,
  revision: 1,
  status: "draft",
  templateKey: null,
  theme: DEFAULT_THEME,
  settings: { serviceDisplay: { order: [], hidden: [] } },
  publishedAt: null,
  pages: [],
};

const rowLink = "inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline";

function EmptyWebsite({ preview }: { preview: boolean }) {
  const { createWebsite } = useWebsite();
  const canManage = useCan("website:manage");
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    const result = await createWebsite();
    setBusy(false);
    if (!result.ok) return toast(result.error);
    router.push("/website");
    // The Website's other tabs are chosen on the server (they exist once the business has a website): ask for them again.
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <EmptyState
        icon={LayoutTemplate}
        title="No website created yet"
        description="Create a simple public website for your business with Services, contact information, and online booking."
        action={
          preview ? (
            <ButtonLink href="/website" size="lg">
              <Plus aria-hidden className="size-4" />
              Create website
            </ButtonLink>
          ) : canManage ? (
            <Button size="lg" onClick={create} disabled={busy}>
              <Plus aria-hidden className="size-4" />
              Create website
            </Button>
          ) : undefined
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

export function WebsiteOverview() {
  const { website } = useWebsite();
  const { settings } = useSettings();
  const brandStyle = useBrandStyle();
  const business = settings.business;
  const hours = useHoursRows();
  const { askUnpublish, unpublishModal } = usePublishing();
  const canManage = useCan("website:manage");
  const preview = useSearchParams().get("state") === "empty";
  const { services: catalog } = useServices();
  // The picture of the site: the published snapshot while it is live, otherwise the Draft. (A hook, so it runs before any early return.)
  const shownVersion = website ? (website.published && website.live ? website.live : website.draft) : null;
  const view = useSiteView(shownVersion ?? EMPTY_VERSION, PREVIEW_BASE);

  if (!website || !shownVersion || preview) return <EmptyWebsite preview={preview} />;

  const homeKey = orderedPages(shownVersion).find((page) => page.type === "home")?.key;
  const home = homeKey ? findPage(shownVersion, homeKey) : undefined;
  const shown = getShownServices(shownVersion.settings.serviceDisplay, catalog);
  const bookable = shown.filter((service) => service.visibility === "public-booking");
  const primary = getPrimaryAddress(website.site, website.domain);
  const platform = getPlatformAddress(website.site, website.domain);
  const pending = hasUnpublishedChanges(website);
  const pages = orderedPages(website.draft);
  const published = website.published;
  const { domain } = website;

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
          value={published ? "Published" : "Draft"}
          icon={published ? CloudUpload : EyeOff}
          hint={published ? `Live at ${primary}` : "Only you can see it until you publish"}
          hintDot={published}
        />
        <KpiCard label="Pages" value={`${pages.length} pages`} icon={Layers} hint={pages.map((page) => page.title).join(", ")} href="/website/pages" />
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
            aside={<span className="text-xs text-ink-muted">{published ? "Live website" : "Draft · not published"}</span>}
          >
            <BrowserFrame address={primary} note={published ? "Live" : "Draft"}>
              <div inert {...themeAttributes(shownVersion.theme)} style={{ ...brandStyle, ...themeStyle(shownVersion.theme) }} className="@container h-80 overflow-hidden bg-surface">
                <SiteHeader view={view} />
                {home && <SiteRenderer page={home} view={view} embedded />}
                <SiteFooter view={view} />
              </div>
            </BrowserFrame>
            <p className="mt-4 text-xs text-ink-muted">Rendered from your saved pages and your Services catalog.</p>
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
                    {canManage ? row.action : "View"}
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-5">
          <Card title="Publishing" aside={<SiteStatusBadge published={published} />}>
            {published ? (
              <>
                <p className="text-sm text-ink-muted">
                  Your website is live and open to visitors. Customers can view your services and book appointments.
                </p>
                {pending && (
                  <p className="mt-3 flex items-start gap-2 rounded-btn bg-warning-soft px-3 py-2 text-xs text-warning">
                    <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    You have saved changes that are not live yet. Choose Publish changes at the top of the page to make them live.
                  </p>
                )}
                {canManage && (
                  <Button variant="secondary" className="mt-4 w-full" onClick={askUnpublish}>
                    <EyeOff aria-hidden className="size-4" />
                    Unpublish
                  </Button>
                )}
                <p className="mt-3 text-xs text-ink-muted">
                  Unpublishing makes the website private without deleting any pages or content.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  Your website is a draft that only you can see.
                  {canManage ? " Choose Publish website at the top of the page when you are satisfied with the content and booking setup." : ""}
                </p>
                <p className="mt-3 rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">
                  Publishing makes the website accessible to customers at <strong className="break-all text-ink">{platform}</strong>. Publishing does not
                  change your Bookings, Services, Customers, Jobs, Invoices, or Payments.
                </p>
              </>
            )}
          </Card>

          <Card title="Website address" aside={<Globe aria-hidden className="size-5 text-ink-muted" />}>
            <ul className="space-y-2">
              <li className="rounded-btn bg-surface-low px-4 py-3">
                <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">Climvia address</p>
                <div className="mt-0.5 flex items-center justify-between gap-3">
                  <p className="min-w-0 font-mono text-sm font-semibold break-all text-ink">{platform}</p>
                  {!primaryDomainOf(domain) && (
                    <span className="shrink-0">
                      <StatusBadge tone="positive">Primary</StatusBadge>
                    </span>
                  )}
                </div>
              </li>
              {domain.domains.map((record) => (
                <li key={record.id} className="rounded-btn bg-surface-low px-4 py-3">
                  <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">Custom domain</p>
                  <div className="mt-0.5 flex items-center justify-between gap-3">
                    <p className="font-mono text-sm font-semibold break-all text-ink">{record.hostname}</p>
                    <span className="flex items-center gap-1.5">
                      {record.isPrimary && <StatusBadge tone="positive">Primary</StatusBadge>}
                      <StatusBadge tone={DOMAIN_TONE[record.status]}>{DOMAIN_STATUS_LABEL[record.status]}</StatusBadge>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/website/domain" className={`${rowLink} mt-3`}>
              {!canManage ? "View domains" : domain.domains.length > 0 ? "Manage domains" : "Connect custom domain"}
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
                  {domain.domains.some((record) => record.status === "active") ? <CircleCheck aria-hidden className="size-4 text-positive" /> : <Circle aria-hidden className="size-4 text-ink-faint" />}
                  Custom domain
                </span>
                <span className="text-xs font-semibold text-ink-muted">{domain.domains[0] ? DOMAIN_STATUS_LABEL[(domain.domains.find((record) => record.status === "active") ?? domain.domains[0]).status] : "Optional"}</span>
              </li>
            </ul>
          </Card>

          <Card title="Online booking" aside={<StatusBadge tone={bookable.length > 0 ? "positive" : "neutral"}>{bookable.length > 0 ? "Enabled" : "Off"}</StatusBadge>}>
            <p className="text-sm text-ink-muted">
              Customers can book or request Services using the booking method set on each Service. Requests arrive in Bookings.
            </p>
            <Link href="/website/booking" className={`${rowLink} mt-3`}>
              {canManage ? "Manage booking setup" : "View booking setup"}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </Card>
        </div>
      </div>
      {unpublishModal}
    </div>
  );
}
