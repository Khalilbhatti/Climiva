"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarCheck, ChevronRight, Clock, Headset, ListChecks, Mail, MapPin, Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type { AppHref } from "@/config/routes";
import { BOOKING_METHOD_ACTION, BOOKING_METHOD_LABEL, formatDuration, formatServicePrice, type Service } from "@/data/services";
import { getShownServices, orderedSections, type PageModel, type SectionModel } from "@/data/website";
import { cn } from "@/lib/cn";
import { formatCityStateZip } from "@/data/fixtures";
import { getInitials, toTelHref } from "@/lib/format";
import { bookingHrefIn, fillProps, pageHrefIn, typeHrefIn, type SiteView } from "./site-view";

/**
 * The customer-facing website, drawn from a page's SECTIONS plus the records it is connected to. Each section is a row of data
 * (a registered type, a variant and plain-text properties, see lib/site-sections); this file holds the one component that draws each
 * registered type. Nothing here knows a page by name, and nothing is read from a section except the properties its type declares.
 *
 * It is used identically for the Draft (the editor's inert canvas, the Overview's picture, the signed-in preview) and for the Published
 * site a visitor opens: the same renderer, fed by the same shape (`SiteView`) from different sources. Sizes follow the width of the frame
 * it sits in (container queries), which is what lets the editor's Desktop / Mobile switch show a real narrow layout.
 */

type Props = {
  page: PageModel;
  view: SiteView;
  /** Highlights one section (editor canvas). */
  activeSection?: string;
  /** A picture of the site inside a workspace page, which already has its own page heading: titles are level 2. */
  embedded?: boolean;
};

/** A link when there is somewhere to go (the page may be hidden or absent), otherwise just the look of one. */
function Go({ href, className, children }: { href: AppHref | undefined; className: string; children: ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

export function SiteHeader({ view }: { view: SiteView }) {
  const booking = typeHrefIn(view, "booking");
  const nav = view.pages.filter((page) => page.type !== "home" && page.type !== "booking");
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-5 py-4 @xl:px-8">
      <Link href={view.base as AppHref} className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-btn bg-primary text-sm font-bold text-white">
          {getInitials(view.business.name)}
        </span>
        <span className="text-sm leading-tight font-bold text-ink">{view.business.name}</span>
      </Link>
      <nav aria-label="Website" className="flex items-center gap-x-5 gap-y-2 text-sm font-medium text-ink-muted">
        {nav.map((page) => (
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

export function SiteFooter({ view }: { view: SiteView }) {
  return (
    <footer className="border-t border-line bg-surface px-5 py-5 text-center text-xs text-ink-muted @xl:px-8">
      © 2025 {view.business.name}. All rights reserved. | Powered by Climvia
    </footer>
  );
}

function Section({
  id,
  active,
  tone = "plain",
  className,
  children,
}: {
  id: string;
  active: boolean;
  tone?: "plain" | "tinted" | "brand";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-section={id}
      className={cn(
        "px-5 py-8 @xl:px-8 @xl:py-10",
        tone === "tinted" && "bg-surface-low",
        tone === "brand" && "bg-primary text-white",
        tone === "plain" && "bg-surface",
        active && "ring-2 ring-primary/70 ring-inset",
        className,
      )}
    >
      {children}
    </section>
  );
}

const alignClass = (alignment: string | undefined) => (alignment === "center" ? "text-center" : "text-left");

function Heading({ title, text, tone, align }: { title: string; text?: string; tone?: "brand"; align?: string }) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto", alignClass(align))}>
      <h2 className={cn("text-xl font-bold tracking-tight @xl:text-2xl", tone === "brand" ? "text-white" : "text-ink")}>{title}</h2>
      {text && <p className={cn("mt-2 text-sm @xl:text-base", tone === "brand" ? "text-white/85" : "text-ink-muted")}>{text}</p>}
    </div>
  );
}

function ServiceCard({ service, view, full }: { service: Service; view: SiteView; full?: boolean }) {
  // On the Services page the cards follow the page heading directly; elsewhere they sit under a section heading.
  const Name: "h2" | "h3" = full ? "h2" : "h3";
  return (
    <li className="flex flex-col rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <Name className="text-sm font-bold text-ink">{service.name}</Name>
        <span className="shrink-0 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">{formatServicePrice(service.pricing)}</span>
      </div>
      <p className={cn("mt-2 text-xs text-ink-muted", !full && "line-clamp-3")}>{service.description}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <Clock aria-hidden className="size-3.5" />
        {formatDuration(service.durationMinutes)} · {BOOKING_METHOD_LABEL[service.bookingMethod]}
      </p>
      <Go href={bookingHrefIn(view, service.id)} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4 self-start" })}>
        {BOOKING_METHOD_ACTION[service.bookingMethod]}
        <ChevronRight aria-hidden className="size-3.5" />
      </Go>
    </li>
  );
}

function ServiceGrid({ view, full }: { view: SiteView; full?: boolean }) {
  const shown = getShownServices(view.display, view.services as Service[]);
  if (shown.length === 0) {
    return <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No services are shown on the website right now.</p>;
  }
  return (
    <ul className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3">
      {shown.map((service) => (
        <ServiceCard key={service.id} service={service} view={view} full={full} />
      ))}
    </ul>
  );
}

function BookingGrid({ view }: { view: SiteView }) {
  const shown = getShownServices(view.display, view.services as Service[]);
  if (shown.length === 0) {
    return <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No services are available to book online right now.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
      {shown.map((service) => {
        const href = bookingHrefIn(view, service.id);
        return (
          <li key={service.id}>
            <Go href={href} className="flex h-full flex-col rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-primary">
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-bold text-ink">{service.name}</span>
                <span className="shrink-0 text-xs font-semibold text-primary">{formatServicePrice(service.pricing)}</span>
              </span>
              <span className="mt-1 text-xs text-ink-muted">
                {formatDuration(service.durationMinutes)} · {BOOKING_METHOD_LABEL[service.bookingMethod]}
              </span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                {BOOKING_METHOD_ACTION[service.bookingMethod]}
                <ChevronRight aria-hidden className="size-3.5" />
              </span>
            </Go>
          </li>
        );
      })}
    </ul>
  );
}

function Hours({ view }: { view: SiteView }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {view.hours.map((row) => (
        <li key={row.days} className="flex justify-between gap-6">
          <span className="font-medium text-ink">{row.days}</span>
          <span className="text-ink-muted">{row.hours}</span>
        </li>
      ))}
    </ul>
  );
}

function ContactDetails({ view }: { view: SiteView }) {
  const { business } = view;
  return (
    <ul className="space-y-3 text-sm">
      <li className="flex items-start gap-2.5">
        <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <a href={toTelHref(business.phone)} className="text-ink hover:underline">
          {business.phone}
        </a>
      </li>
      <li className="flex items-start gap-2.5">
        <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <a href={`mailto:${business.email}`} className="text-ink hover:underline">
          {business.email}
        </a>
      </li>
      <li className="flex items-start gap-2.5">
        <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="text-ink">
          {business.address.street}
          <br />
          {formatCityStateZip(business.address)}
        </span>
      </li>
    </ul>
  );
}

function InfoCard({ title, children, as: Level = "h3" }: { title: string; children: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <Level className="mb-3 text-xs font-bold tracking-wider text-ink-muted uppercase">{title}</Level>
      {children}
    </div>
  );
}

function Trio({ values, icons }: { values: Record<string, string>; icons: boolean }) {
  const ICONS = [ListChecks, CalendarCheck, Headset];
  return (
    <ul className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-3">
      {[1, 2, 3].map((n, index) => {
        const Icon = ICONS[index];
        return (
          <li key={n} className="rounded-card border border-line bg-surface p-4">
            {icons && <Icon aria-hidden className="mb-3 size-5 text-primary" />}
            <h3 className="text-sm font-bold text-ink">{values[`item${n}Title`]}</h3>
            <p className="mt-1 text-xs text-ink-muted">{values[`item${n}Text`]}</p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A message form. Nothing is delivered anywhere (there is no mail or text-message provider yet), so on the public site it says so and
 * points to the business's phone and email instead of claiming a message was sent. Inside the workspace (the signed-in preview) it keeps
 * the approved confirmation, which is a picture of the finished product.
 */
function ContactForm({ view }: { view: SiteView }) {
  const { business } = view;
  const [sentTo, setSentTo] = useState<string>();
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "message", string>>>({});

  if (sentTo !== undefined) {
    return view.visitor ? (
      <div role="status" className="rounded-card border border-line bg-surface-low p-5">
        <h3 className="text-sm font-bold text-ink">We can&apos;t take messages here yet</h3>
        <p className="mt-1 text-sm text-ink">
          Thanks, {sentTo}. Messages sent from this form aren&apos;t delivered yet, so please call {business.name} at{" "}
          <a href={toTelHref(business.phone)} className="font-semibold text-primary hover:underline">
            {business.phone}
          </a>{" "}
          or email{" "}
          <a href={`mailto:${business.email}`} className="font-semibold text-primary hover:underline">
            {business.email}
          </a>
          .
        </p>
      </div>
    ) : (
      <div role="status" className="rounded-card border border-positive-line bg-positive-soft p-5">
        <h3 className="text-sm font-bold text-positive">Message sent</h3>
        <p className="mt-1 text-sm text-ink">
          Thanks, {sentTo}. {business.name} will follow up with you by email or phone.
        </p>
        <button
          type="button"
          onClick={() => {
            setSentTo(undefined);
            setForm({ name: "", email: "", phone: "", message: "" });
          }}
          className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4" })}
        >
          Send another message
        </button>
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (!form.message.trim()) next.message = "Enter a message.";
    setErrors(next);
    if (Object.keys(next).length === 0) setSentTo(form.name.trim().split(/\s+/)[0]);
  }

  const bind = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-card border border-line bg-surface p-5">
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
        <Input label="Full name" required autoComplete="name" error={errors.name} {...bind("name")} />
        <Input label="Phone (optional)" type="tel" autoComplete="tel" {...bind("phone")} />
      </div>
      <Input label="Email" type="email" required autoComplete="email" error={errors.email} {...bind("email")} />
      <Textarea label="Message" required error={errors.message} {...bind("message")} />
      <button type="submit" className={buttonClasses({})}>
        Send message
      </button>
    </form>
  );
}

function Intro({ values, Title }: { values: Record<string, string>; Title: "h1" | "h2" }) {
  return (
    <div className={cn("max-w-2xl", values.alignment === "center" && "mx-auto", alignClass(values.alignment))}>
      <Title className="text-2xl font-bold tracking-tight text-ink @xl:text-3xl">{values.heading}</Title>
      <p className="mt-2 text-sm text-ink-muted @xl:text-base">{values.supportingText}</p>
    </div>
  );
}

/**
 * One registered section, drawn. An unknown type or variant draws nothing (it never reaches here: the loaders drop them). `primary` marks
 * the section that carries the page's one level-1 heading (the first hero or page heading on the page); any other title is level 2, so a
 * page that has two of them still has one h1.
 */
export function SiteSection({ section, view, active = false, embedded, primary = true }: { section: SectionModel; view: SiteView; active?: boolean; embedded?: boolean; primary?: boolean }) {
  const values = fillProps(section.props, view.business);
  const Title: "h1" | "h2" = embedded || !primary ? "h2" : "h1";
  const id = section.key;

  switch (section.type) {
    case "hero":
      return (
        <Section id={id} active={active} tone="brand" className="@xl:py-14">
          <div className={cn("max-w-2xl", values.alignment === "center" && "mx-auto", alignClass(values.alignment))}>
            <Title className="text-2xl font-bold tracking-tight @xl:text-4xl">{values.headline}</Title>
            <p className="mt-3 text-sm text-white/85 @xl:text-base">{values.supportingText}</p>
            <div className={cn("mt-6 flex flex-wrap gap-3", values.alignment === "center" && "justify-center")}>
              <Go
                href={typeHrefIn(view, "booking")}
                className="inline-flex items-center rounded-btn bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-subtle"
              >
                {values.primaryCta}
              </Go>
              <Go
                href={typeHrefIn(view, "services")}
                className="inline-flex items-center rounded-btn border border-white/50 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
              >
                {values.secondaryCta}
              </Go>
            </div>
          </div>
        </Section>
      );
    case "page_intro":
      return (
        <Section id={id} active={active} tone="tinted">
          <Intro values={values} Title={Title} />
        </Section>
      );
    case "service_list":
      if (section.variant === "booking") {
        return (
          <Section id={id} active={active}>
            <BookingGrid view={view} />
          </Section>
        );
      }
      if (section.variant === "catalog") {
        return (
          <Section id={id} active={active}>
            <ServiceGrid view={view} full />
          </Section>
        );
      }
      return (
        <Section id={id} active={active} tone="tinted">
          <Heading title={values.heading ?? ""} text={values.supportingText} />
          <ServiceGrid view={view} />
        </Section>
      );
    case "feature_list":
      return section.variant === "icons" ? (
        <Section id={id} active={active}>
          <Heading title={values.heading ?? ""} />
          <Trio values={values} icons />
        </Section>
      ) : (
        <Section id={id} active={active} tone="tinted">
          <Heading title={values.heading ?? ""} text={values.supportingText} />
          <Trio values={values} icons={false} />
        </Section>
      );
    case "rich_text":
      return (
        <Section id={id} active={active}>
          <Heading title={values.heading ?? ""} text={values.body} />
        </Section>
      );
    case "business_hours":
      return (
        <Section id={id} active={active} tone="tinted">
          <InfoCard title="Business hours" as={section.variant === "page" ? "h2" : "h3"}>
            <Hours view={view} />
          </InfoCard>
        </Section>
      );
    case "contact_details":
      if (section.variant === "callout") {
        return (
          <Section id={id} active={active} tone="tinted">
            <Heading title={values.heading ?? ""} text={values.supportingText} />
            <div className="mt-4 max-w-sm">
              <InfoCard title="Contact us">
                <ContactDetails view={view} />
              </InfoCard>
            </div>
          </Section>
        );
      }
      return (
        <Section id={id} active={active}>
          <InfoCard title={section.variant === "page" ? "Contact details" : "Contact us"} as={section.variant === "page" ? "h2" : "h3"}>
            <ContactDetails view={view} />
          </InfoCard>
        </Section>
      );
    case "business_details":
      return (
        <Section id={id} active={active}>
          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
            <InfoCard title={view.business.name}>
              <ContactDetails view={view} />
            </InfoCard>
            <InfoCard title="Business hours">
              <Hours view={view} />
            </InfoCard>
          </div>
        </Section>
      );
    case "contact_form":
      return (
        <Section id={id} active={active} tone="tinted">
          <Heading title={values.heading ?? ""} text={values.supportingText} />
          <div className="mt-5 max-w-xl">
            <ContactForm view={view} />
          </div>
        </Section>
      );
    case "call_to_action":
      return (
        <Section id={id} active={active} tone="brand">
          <div className="flex flex-col items-start justify-between gap-5 @2xl:flex-row @2xl:items-center">
            <Heading title={values.heading ?? ""} text={values.supportingText} tone="brand" />
            <Go
              href={typeHrefIn(view, "booking")}
              className="inline-flex shrink-0 items-center gap-2 rounded-btn bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-subtle"
            >
              {values.buttonLabel}
              <ArrowRight aria-hidden className="size-4" />
            </Go>
          </div>
        </Section>
      );
    default:
      return null;
  }
}

/** The key of the section that carries a page's level-1 heading: the first visible hero or page heading. */
export function titleSectionKey(page: PageModel): string | undefined {
  return orderedSections(page).find((section) => section.visible && (section.type === "hero" || section.type === "page_intro"))?.key;
}

/** A page: its visible sections in order, each drawn by the component its type is registered to. */
export function SiteRenderer({ page, view, activeSection, embedded }: Props) {
  const titleKey = titleSectionKey(page);
  return (
    <>
      {orderedSections(page)
        .filter((section) => section.visible)
        .map((section) => (
          <SiteSection key={section.key} section={section} view={view} active={activeSection === section.key} embedded={embedded} primary={section.key === titleKey} />
        ))}
    </>
  );
}
