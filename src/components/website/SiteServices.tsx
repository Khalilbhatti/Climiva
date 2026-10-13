"use client";

import { ArrowUpRight, ChevronRight, Clock, Fan, Flame, Snowflake, Thermometer, Wind, Wrench } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { BOOKING_METHOD_ACTION, BOOKING_METHOD_LABEL, formatDuration, formatServicePrice, type Service } from "@/data/services";
import { getShownServices } from "@/data/website";
import { cn } from "@/lib/cn";
import { Go, NoServices, ServiceFacts } from "./site-primitives";
import type { LookTokens } from "./site-look";
import { bookingHrefIn, type SiteView } from "./site-view";

/**
 * The Template presentations of the business's Services. The Services themselves are never copied: every presentation lists the ones the
 * site shows (the version's settings choose which, and in what order) from the business's own catalog, with their name, price, duration
 * and booking method read from it. A presentation is only how they are laid out:
 *
 *   grid      a ruled specification grid: name and price on top, the facts in labelled cells (Precision)
 *   friendly  roomy rounded cards with an icon, the full description and a booking button (Comfort)
 *   rows      large, quiet rows like an index: name, description, price and a link (Airflow)
 *
 * `full` is the list on a Services page, under the page's own heading: a Service's name is then a level-2 heading, otherwise level 3.
 */
export type ServicePresentation = "grid" | "friendly" | "rows";

/** Icons are decoration for the friendly cards (hidden from assistive technology); they are chosen by position, never from a name. */
const ICONS = [Thermometer, Snowflake, Flame, Wind, Fan, Wrench] as const;

export function ServiceCollection({ presentation, view, look, full }: { presentation: ServicePresentation; view: SiteView; look: LookTokens; full?: boolean }) {
  const shown = getShownServices(view.display, view.services as Service[]);
  if (shown.length === 0) return <NoServices>No services are shown on the website right now.</NoServices>;
  const Name: "h2" | "h3" = full ? "h2" : "h3";

  if (presentation === "grid") {
    return (
      <ul className="mt-6 grid grid-cols-1 border-t border-l border-line-strong @2xl:grid-cols-2 @4xl:grid-cols-3">
        {shown.map((service) => (
          <li key={service.id} className="flex flex-col border-r border-b border-line-strong bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <Name className="text-sm font-extrabold tracking-tight text-ink">{service.name}</Name>
              <span className="shrink-0 text-sm font-bold text-primary tabular-nums">{formatServicePrice(service.pricing)}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{service.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 border-t border-line pt-3 text-xs">
              <div>
                <dt className="text-micro font-bold tracking-widest text-ink-muted uppercase">Duration</dt>
                <dd className="mt-0.5 text-ink">{formatDuration(service.durationMinutes)}</dd>
              </div>
              <div>
                <dt className="text-micro font-bold tracking-widest text-ink-muted uppercase">Booking</dt>
                <dd className="mt-0.5 text-ink">{BOOKING_METHOD_LABEL[service.bookingMethod]}</dd>
              </div>
            </dl>
            <Go href={bookingHrefIn(view, service.id)} className="mt-3 inline-flex items-center gap-1 self-start text-xs font-bold text-primary hover:underline">
              {BOOKING_METHOD_ACTION[service.bookingMethod]}
              <ChevronRight aria-hidden className="size-3.5" />
            </Go>
          </li>
        ))}
      </ul>
    );
  }

  if (presentation === "friendly") {
    return (
      <ul className="mt-8 grid grid-cols-1 gap-5 @2xl:grid-cols-2">
        {shown.map((service, index) => {
          const Icon = ICONS[index % ICONS.length];
          return (
            <li key={service.id} className={cn("flex flex-col p-6", look.raised)}>
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
                  <Icon className="size-5" />
                </span>
                <Name className="text-lg font-semibold text-ink">{service.name}</Name>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{service.description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary-subtle px-3 py-1 text-xs font-semibold text-primary">{formatServicePrice(service.pricing)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-low px-3 py-1 text-xs font-medium text-ink-muted">
                  <Clock aria-hidden className="size-3.5" />
                  <ServiceFacts service={service} />
                </span>
              </div>
              <Go href={bookingHrefIn(view, service.id)} className={buttonClasses({ variant: "secondary", className: cn("mt-5 self-start", look.button) })}>
                {BOOKING_METHOD_ACTION[service.bookingMethod]}
                <ChevronRight aria-hidden className="size-4" />
              </Go>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="mt-10 divide-y divide-line-strong border-y border-line-strong">
      {shown.map((service) => (
        <li key={service.id} className="grid gap-4 py-7 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_11rem] @2xl:items-baseline @2xl:gap-10">
          <Name className="text-2xl font-light tracking-tight text-ink @xl:text-3xl">{service.name}</Name>
          <div>
            <p className="line-clamp-3 text-sm font-light text-ink-muted @xl:text-base">{service.description}</p>
            <p className="mt-2 text-xs text-ink-muted">
              <ServiceFacts service={service} />
            </p>
          </div>
          <div className="flex items-center justify-between gap-6 @2xl:flex-col @2xl:items-end @2xl:justify-start @2xl:gap-3">
            <span className="text-lg font-medium text-ink tabular-nums">{formatServicePrice(service.pricing)}</span>
            <Go href={bookingHrefIn(view, service.id)} className="inline-flex items-center gap-1 text-sm font-medium text-ink underline decoration-1 underline-offset-4 hover:text-primary">
              {BOOKING_METHOD_ACTION[service.bookingMethod]}
              <ArrowUpRight aria-hidden className="size-4" />
            </Go>
          </div>
        </li>
      ))}
    </ul>
  );
}
