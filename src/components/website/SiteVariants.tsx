"use client";

import { ArrowRight, ArrowUpRight, CircleCheck, Check, Fan, House, Phone, Snowflake, Thermometer } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { toTelHref } from "@/lib/format";
import { Go, Heading, Hours, Section } from "./site-primitives";
import type { LookTokens } from "./site-look";
import { typeHrefIn, type SiteView } from "./site-view";

/**
 * The structural variants the Templates are made of: an opening, a row of reassurance and a closing call to action, each drawn three
 * ways beyond the standard one. A variant is only STRUCTURE (what is where); the design style around it (spacing, type, corners) comes
 * from the site's look, and the words come from the section's own properties. The business's phone number and hours are read from the
 * view when the page is drawn, never copied into a section.
 *
 * Every variant keeps the page's outline: the opening carries the page's one level-1 heading when it is the first heading on the page, and
 * every other title here is level 2 with its items at level 3. Decoration is hidden from assistive technology.
 */

type Common = { id: string; active: boolean; look: LookTokens; values: Record<string, string>; view: SiteView };
type Opening = Common & { Title: "h1" | "h2" };

const PhoneLink = ({ view, className }: { view: SiteView; className?: string }) => (
  <a href={toTelHref(view.business.phone)} className={className}>
    <Phone aria-hidden className="size-4 shrink-0" />
    {view.business.phone}
  </a>
);

/* ───────────────────────── openings ───────────────────────── */

/** A headline and two buttons beside a panel with the business's phone number and hours. */
export function HeroSplit({ id, active, look, values, view, Title }: Opening) {
  return (
    <Section id={id} active={active} look={look} className={look.heroPad}>
      <div className="grid items-center gap-8 @3xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] @3xl:gap-12">
        <div>
          <Title className="text-3xl font-extrabold tracking-tight text-ink @xl:text-5xl @xl:leading-[1.05]">{values.headline}</Title>
          <p className="mt-4 max-w-xl text-base text-ink-muted">{values.supportingText}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Go href={typeHrefIn(view, "booking")} className={buttonClasses({ size: "lg", className: look.button })}>
              {values.primaryCta}
            </Go>
            <Go href={typeHrefIn(view, "services")} className={buttonClasses({ variant: "secondary", size: "lg", className: look.button })}>
              {values.secondaryCta}
            </Go>
          </div>
        </div>
        <aside aria-label="Call and hours" className="rounded-card border border-line-strong bg-surface-low p-5">
          <p className="text-xs font-bold tracking-widest text-primary uppercase">Call us</p>
          <a href={toTelHref(view.business.phone)} className="mt-1 block text-2xl font-extrabold tracking-tight text-ink hover:underline">
            {view.business.phone}
          </a>
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-xs font-bold tracking-widest text-ink-muted uppercase">Business hours</p>
            <Hours view={view} />
          </div>
        </aside>
      </div>
    </Section>
  );
}

const TILES = [House, Thermometer, Fan, Snowflake] as const;

/** A warm, light opening with a large headline, a booking button and a way to call. The tiles are decoration. */
export function HeroWelcome({ id, active, look, values, view, Title }: Opening) {
  return (
    <Section id={id} active={active} look={look} tone="tinted" className={cn("relative overflow-hidden", look.heroPad)}>
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-primary/10" />
      <div className="relative grid items-center gap-10 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <Title className="text-4xl leading-[1.1] font-semibold tracking-tight text-ink @xl:text-6xl">{values.headline}</Title>
          <p className="mt-5 max-w-xl text-base text-ink-muted @xl:text-lg">{values.supportingText}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Go href={typeHrefIn(view, "booking")} className={buttonClasses({ size: "lg", className: look.button })}>
              {values.primaryCta}
            </Go>
            <Go href={typeHrefIn(view, "services")} className={buttonClasses({ variant: "secondary", size: "lg", className: look.button })}>
              {values.secondaryCta}
            </Go>
          </div>
          <PhoneLink view={view} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline" />
        </div>
        <div aria-hidden className="hidden grid-cols-2 gap-4 @3xl:grid">
          {TILES.map((Icon, index) => (
            <span key={index} className={cn("flex aspect-square items-center justify-center rounded-3xl bg-surface shadow-overlay", index % 2 === 1 && "mt-8", index === 2 && "-mt-4")}>
              <Icon className="size-10 text-primary" />
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

/** A very large headline with its introduction set beside it, and two quiet links under a rule. */
export function HeroEditorial({ id, active, look, values, view, Title }: Opening) {
  return (
    <Section id={id} active={active} look={look} className={look.heroPad}>
      {/* The headline and its introduction sit side by side only when the frame is wide; on a tablet the introduction would be a sliver. */}
      <div className="grid gap-8 @4xl:grid-cols-12 @4xl:items-end @4xl:gap-10">
        <Title className="text-4xl leading-[1.04] font-light tracking-tight text-ink @xl:text-6xl @4xl:col-span-9 @4xl:text-7xl">{values.headline}</Title>
        <p className="max-w-md text-base font-light text-ink-muted @xl:text-lg @4xl:col-span-3 @4xl:max-w-sm">{values.supportingText}</p>
      </div>
      <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-line-strong pt-8">
        <Go href={typeHrefIn(view, "booking")} className={buttonClasses({ size: "lg", className: look.button })}>
          {values.primaryCta}
          <ArrowUpRight aria-hidden className="size-4" />
        </Go>
        <Go href={typeHrefIn(view, "services")} className="text-base font-light text-ink underline decoration-1 underline-offset-8 hover:text-primary">
          {values.secondaryCta}
        </Go>
      </div>
    </Section>
  );
}

/* ───────────────────────── reassurance ───────────────────────── */

const items = (values: Record<string, string>) => [1, 2, 3].map((n) => ({ n, title: values[`item${n}Title`], text: values[`item${n}Text`] }));

/** Three short points in one ruled band, each with a check mark. */
export function FeatureStrip({ id, active, look, values }: Omit<Common, "view">) {
  return (
    <Section id={id} active={active} look={look}>
      <Heading look={look} title={values.heading ?? ""} />
      <ul className="mt-5 grid grid-cols-1 divide-y divide-line-strong border border-line-strong bg-surface-low @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0">
        {items(values).map((item) => (
          <li key={item.n} className="flex gap-3 p-4">
            <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={3} />
            <div>
              <h3 className="text-sm font-bold text-ink">{item.title}</h3>
              <p className="mt-1 text-xs text-ink-muted">{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Three numbered steps with no boxes around them: only a rule and a number. */
export function FeatureNumbered({ id, active, look, values }: Omit<Common, "view">) {
  return (
    <Section id={id} active={active} look={look} tone="tinted">
      <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
      <ol className="mt-12 grid grid-cols-1 gap-10 @2xl:grid-cols-3 @2xl:gap-8">
        {items(values).map((item) => (
          <li key={item.n} className="border-t border-ink pt-5">
            <span aria-hidden className="text-sm font-medium tracking-widest text-ink-muted tabular-nums">
              {String(item.n).padStart(2, "0")}
            </span>
            <h3 className="mt-3 text-xl font-medium tracking-tight text-ink">{item.title}</h3>
            <p className="mt-2 text-sm font-light text-ink-muted @xl:text-base">{item.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** A soft rounded panel with a heading and three reasons, each with a check mark. */
export function FeatureReassure({ id, active, look, values }: Omit<Common, "view">) {
  return (
    <Section id={id} active={active} look={look} tone="tinted">
      <div className={cn("p-6 @xl:p-10", look.raised)}>
        <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
        <ul className="mt-8 grid grid-cols-1 gap-6 @2xl:grid-cols-3">
          {items(values).map((item) => (
            <li key={item.n} className="flex gap-3">
              <CircleCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
              <div>
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ───────────────────────── closing calls to action ───────────────────────── */

type Closing = Common;

/** A ruled band: the heading on one side, a booking button and the phone number on the other. */
export function CtaBand({ id, active, look, values, view }: Closing) {
  return (
    <Section id={id} active={active} look={look} tone="none" className="border-y-2 border-primary bg-surface-low">
      <div className="flex flex-col gap-5 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Go href={typeHrefIn(view, "booking")} className={buttonClasses({ size: "lg", className: look.button })}>
            {values.buttonLabel}
            <ArrowRight aria-hidden className="size-4" />
          </Go>
          <a href={toTelHref(view.business.phone)} className={buttonClasses({ variant: "secondary", size: "lg", className: look.button })}>
            <Phone aria-hidden className="size-4" />
            {view.business.phone}
          </a>
        </div>
      </div>
    </Section>
  );
}

/** A soft, centered panel with a heading, a booking button and a way to call. */
export function CtaPanel({ id, active, look, values, view }: Closing) {
  return (
    <Section id={id} active={active} look={look}>
      <div className="mx-auto max-w-3xl rounded-card bg-primary-subtle px-6 py-10 text-center @xl:px-12 @xl:py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-ink @xl:text-4xl">{values.heading}</h2>
        <p className="mx-auto mt-3 max-w-xl text-base text-ink-muted @xl:text-lg">{values.supportingText}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
          <Go href={typeHrefIn(view, "booking")} className={buttonClasses({ size: "lg", className: look.button })}>
            {values.buttonLabel}
          </Go>
          <PhoneLink view={view} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline" />
        </div>
      </div>
    </Section>
  );
}

/** A large statement under a rule, with one booking button. */
export function CtaEditorial({ id, active, look, values, view }: Closing) {
  return (
    <Section id={id} active={active} look={look} className="border-t border-line-strong">
      <h2 className="max-w-4xl text-3xl leading-[1.08] font-light tracking-tight text-ink @xl:text-6xl">{values.heading}</h2>
      <p className="mt-5 max-w-xl text-base font-light text-ink-muted @xl:text-lg">{values.supportingText}</p>
      <Go href={typeHrefIn(view, "booking")} className={buttonClasses({ size: "lg", className: cn("mt-8", look.button) })}>
        {values.buttonLabel}
        <ArrowUpRight aria-hidden className="size-4" />
      </Go>
    </Section>
  );
}
