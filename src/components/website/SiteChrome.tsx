"use client";

import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import type { AppHref } from "@/config/routes";
import { formatCityStateZip } from "@/data/fixtures";
import { cn } from "@/lib/cn";
import { getInitials, toTelHref } from "@/lib/format";
import { looksOf } from "./site-look";
import { pageHrefIn, typeHrefIn, type SiteView } from "./site-view";

/**
 * The header and footer of a drawn website. They are not sections, so they cannot be chosen per page; they follow the site's design style
 * (`theme.look`) instead, so the whole frame around the pages belongs to the same Template as the pages do. Everything in them is read from
 * the view when the page is drawn: the business's name, phone, email, address and hours, and the visible pages in order. Nothing is copied.
 *
 * The standard style is the header and footer the renderer has always drawn.
 */

type Chrome = { view: SiteView };

const homeHref = (view: SiteView) => view.base as AppHref;

/** The pages the navigation lists: every visible page except the home page (the name leads there) and the booking page (it has a button). */
const navPages = (view: SiteView) => view.pages.filter((page) => page.type !== "home" && page.type !== "booking");

function StandardHeader({ view }: Chrome) {
  const booking = typeHrefIn(view, "booking");
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-5 py-4 @xl:px-8">
      <Link href={homeHref(view)} className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-btn bg-primary text-sm font-bold text-white">
          {getInitials(view.business.name)}
        </span>
        <span className="text-sm leading-tight font-bold text-ink">{view.business.name}</span>
      </Link>
      <nav aria-label="Website" className="flex items-center gap-x-5 gap-y-2 text-sm font-medium text-ink-muted">
        {navPages(view).map((page) => (
          <Link key={page.key} href={pageHrefIn(view, page.key)} className="hover:text-ink">
            {page.title}
          </Link>
        ))}
        {booking && (
          <Link href={booking} className={buttonClasses({ size: "sm" })}>
            Book service
          </Link>
        )}
      </nav>
    </header>
  );
}

function PrecisionHeader({ view }: Chrome) {
  const look = looksOf({ look: "precision" });
  const booking = typeHrefIn(view, "booking");
  const first = view.hours[0];
  return (
    <header className="border-b-2 border-primary bg-surface">
      <div className="bg-ink text-xs text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-1.5 @xl:px-8">
          <span>{first ? `${first.days}: ${first.hours}` : view.business.name}</span>
          <a href={toTelHref(view.business.phone)} className="inline-flex items-center gap-1.5 font-semibold hover:underline">
            <Phone aria-hidden className="size-3" />
            {view.business.phone}
          </a>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5 @xl:px-8">
        <Link href={homeHref(view)} className="flex items-center gap-2.5">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-btn bg-primary text-sm font-extrabold text-white">
            {getInitials(view.business.name)}
          </span>
          <span className="text-base leading-tight font-extrabold tracking-tight text-ink">{view.business.name}</span>
        </Link>
        <nav aria-label="Website" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold tracking-wider text-ink uppercase">
          {navPages(view).map((page) => (
            <Link key={page.key} href={pageHrefIn(view, page.key)} className="hover:text-primary">
              {page.title}
            </Link>
          ))}
          {booking && (
            <Link href={booking} className={buttonClasses({ size: "sm", className: cn("tracking-wider uppercase", look.button) })}>
              Book service
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function ComfortHeader({ view }: Chrome) {
  const look = looksOf({ look: "comfort" });
  const booking = typeHrefIn(view, "booking");
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 @xl:px-8">
        <Link href={homeHref(view)} className="flex items-center gap-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
            {getInitials(view.business.name)}
          </span>
          <span className="text-lg leading-tight font-semibold text-ink" style={{ fontFamily: "var(--site-font-heading)" }}>
            {view.business.name}
          </span>
        </Link>
        <nav aria-label="Website" className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm font-medium text-ink-muted">
          {navPages(view).map((page) => (
            <Link key={page.key} href={pageHrefIn(view, page.key)} className="rounded-full px-3.5 py-2 hover:bg-primary-subtle hover:text-primary">
              {page.title}
            </Link>
          ))}
          {booking && (
            <Link href={booking} className={buttonClasses({ className: cn("ml-2", look.button) })}>
              Book service
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function AirflowHeader({ view }: Chrome) {
  const booking = typeHrefIn(view, "booking");
  return (
    <header className="bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-6 @xl:px-10">
        <Link href={homeHref(view)} className="text-sm font-medium tracking-[0.2em] text-ink uppercase">
          {view.business.name}
        </Link>
        <nav aria-label="Website" className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm font-light text-ink-muted">
          {navPages(view).map((page) => (
            <Link key={page.key} href={pageHrefIn(view, page.key)} className="hover:text-ink">
              {page.title}
            </Link>
          ))}
          {booking && (
            <Link href={booking} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-1 underline-offset-8 hover:text-primary">
              Book service
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteHeader({ view }: Chrome) {
  switch (view.theme.look) {
    case "precision":
      return <PrecisionHeader view={view} />;
    case "comfort":
      return <ComfortHeader view={view} />;
    case "airflow":
      return <AirflowHeader view={view} />;
    default:
      return <StandardHeader view={view} />;
  }
}

/* ───────────────────────── footers ───────────────────────── */

const copyright = (view: SiteView) => `© 2025 ${view.business.name}. All rights reserved. | Powered by Climvia`;

function HoursList({ view, className }: Chrome & { className?: string }) {
  return (
    <ul className={cn("space-y-1 text-sm", className)}>
      {view.hours.map((row) => (
        <li key={row.days} className="flex justify-between gap-6">
          <span>{row.days}</span>
          <span>{row.hours}</span>
        </li>
      ))}
    </ul>
  );
}

function StandardFooter({ view }: Chrome) {
  return <footer className="border-t border-line bg-surface px-5 py-5 text-center text-xs text-ink-muted @xl:px-8">{copyright(view)}</footer>;
}

function PrecisionFooter({ view }: Chrome) {
  const { business } = view;
  return (
    <footer className="bg-ink text-white/85">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 @xl:px-8 @2xl:grid-cols-3">
        <div>
          <p className="text-base font-extrabold tracking-tight text-white">{business.name}</p>
          <address className="mt-2 text-sm not-italic">
            {business.address.street}
            <br />
            {formatCityStateZip(business.address)}
          </address>
        </div>
        <div>
          <p className="text-xs font-bold tracking-widest text-white uppercase">Contact</p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <a href={toTelHref(business.phone)} className="hover:underline">
                {business.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${business.email}`} className="hover:underline">
                {business.email}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold tracking-widest text-white uppercase">Business hours</p>
          <HoursList view={view} className="mt-2" />
        </div>
      </div>
      <div className="border-t border-white/15">
        <p className="mx-auto max-w-6xl px-5 py-4 text-xs @xl:px-8">{copyright(view)}</p>
      </div>
    </footer>
  );
}

function ComfortFooter({ view }: Chrome) {
  const { business } = view;
  return (
    <footer className="bg-primary-subtle text-center">
      <div className="mx-auto max-w-5xl px-5 py-10 @xl:px-8">
        <p className="text-lg font-semibold text-ink" style={{ fontFamily: "var(--site-font-heading)" }}>
          {business.name}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          <a href={toTelHref(business.phone)} className="hover:underline">
            {business.phone}
          </a>
          {" · "}
          <a href={`mailto:${business.email}`} className="hover:underline">
            {business.email}
          </a>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {business.address.street}, {formatCityStateZip(business.address)}
        </p>
        <p className="mt-6 text-xs text-ink-muted">{copyright(view)}</p>
      </div>
    </footer>
  );
}

function AirflowFooter({ view }: Chrome) {
  const { business } = view;
  return (
    <footer className="border-t border-line-strong bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 @xl:px-10 @2xl:grid-cols-[2fr_1fr_1fr]">
        <p className="text-2xl font-light tracking-tight text-ink @xl:text-4xl">{business.name}</p>
        <ul className="space-y-1 text-sm font-light text-ink-muted">
          <li>
            <a href={toTelHref(business.phone)} className="hover:text-ink hover:underline">
              {business.phone}
            </a>
          </li>
          <li>
            <a href={`mailto:${business.email}`} className="hover:text-ink hover:underline">
              {business.email}
            </a>
          </li>
          <li>{business.address.street}</li>
          <li>{formatCityStateZip(business.address)}</li>
        </ul>
        <HoursList view={view} className="font-light text-ink-muted" />
      </div>
      <p className="mx-auto max-w-6xl px-5 pb-8 text-xs text-ink-muted @xl:px-10">{copyright(view)}</p>
    </footer>
  );
}

export function SiteFooter({ view }: Chrome) {
  switch (view.theme.look) {
    case "precision":
      return <PrecisionFooter view={view} />;
    case "comfort":
      return <ComfortFooter view={view} />;
    case "airflow":
      return <AirflowFooter view={view} />;
    default:
      return <StandardFooter view={view} />;
  }
}
