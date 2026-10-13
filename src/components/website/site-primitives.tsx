"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Clock, Mail, MapPin, Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type { AppHref } from "@/config/routes";
import { BOOKING_METHOD_ACTION, BOOKING_METHOD_LABEL, formatDuration, formatServicePrice, type Service } from "@/data/services";
import { getShownServices } from "@/data/website";
import { cn } from "@/lib/cn";
import { formatCityStateZip, toTelHref } from "@/lib/format";
import type { LookTokens } from "./site-look";
import { bookingHrefIn, type SiteView } from "./site-view";

/**
 * The parts every section of a drawn website is made of: a link-or-label, the section frame, a heading, the cards for Services and
 * information, the hours, the contact details and the message form. They draw in the DESIGN STYLE they are given (`look`, see
 * ./site-look); the style "standard" is what the renderer drew before styles existed. The renderer (./SiteRenderer) and the Template
 * variants (./SiteVariants, ./SiteServices) compose them.
 */

/** A link when there is somewhere to go (the page may be hidden or absent), otherwise just the look of one. */
export function Go({ href, className, children }: { href: AppHref | undefined; className: string; children: ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

export function Section({
  id,
  active,
  tone = "plain",
  look,
  className,
  children,
}: {
  id: string;
  active: boolean;
  /** "none" leaves the background to the caller's own classes. */
  tone?: "plain" | "tinted" | "brand" | "none";
  look: LookTokens;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-section={id} className={cn(look.pad, tone !== "none" && look.tone[tone], active && "ring-2 ring-primary/70 ring-inset", className)}>
      {look.inner ? <div className={look.inner}>{children}</div> : children}
    </section>
  );
}

export const alignClass = (alignment: string | undefined) => (alignment === "center" ? "text-center" : "text-left");

export function Heading({ look, title, text, tone, align }: { look: LookTokens; title: string; text?: string; tone?: "brand"; align?: string }) {
  return (
    <div className={cn(look.head.wrap, align === "center" && "mx-auto", alignClass(align))}>
      <h2 className={cn(look.head.title, tone === "brand" ? "text-white" : "text-ink")}>{title}</h2>
      {text && <p className={cn(look.head.lead, tone === "brand" ? "text-white/85" : "text-ink-muted")}>{text}</p>}
    </div>
  );
}

export function Intro({ look, values, Title }: { look: LookTokens; values: Record<string, string>; Title: "h1" | "h2" }) {
  return (
    <div className={cn(look.intro.wrap, values.alignment === "center" && "mx-auto", alignClass(values.alignment))}>
      <Title className={cn(look.intro.title, "text-ink")}>{values.heading}</Title>
      <p className={cn(look.intro.lead, "text-ink-muted")}>{values.supportingText}</p>
    </div>
  );
}

/** A Service's price and, below it, how long it takes and how it is booked: the facts every presentation shows. */
export function ServiceFacts({ service }: { service: Service }) {
  return (
    <>
      {formatDuration(service.durationMinutes)} · {BOOKING_METHOD_LABEL[service.bookingMethod]}
    </>
  );
}

export function ServiceCard({ service, view, look, full }: { service: Service; view: SiteView; look: LookTokens; full?: boolean }) {
  // On the Services page the cards follow the page heading directly; elsewhere they sit under a section heading.
  const Name: "h2" | "h3" = full ? "h2" : "h3";
  return (
    <li className={cn("flex flex-col", look.raised, look.cardPad)}>
      <div className="flex items-start justify-between gap-3">
        <Name className="text-sm font-bold text-ink">{service.name}</Name>
        <span className="shrink-0 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">{formatServicePrice(service.pricing)}</span>
      </div>
      <p className={cn("mt-2 text-xs text-ink-muted", !full && "line-clamp-3")}>{service.description}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <Clock aria-hidden className="size-3.5" />
        <ServiceFacts service={service} />
      </p>
      <Go href={bookingHrefIn(view, service.id)} className={buttonClasses({ variant: "secondary", size: "sm", className: cn("mt-4 self-start", look.button) })}>
        {BOOKING_METHOD_ACTION[service.bookingMethod]}
        <ChevronRight aria-hidden className="size-3.5" />
      </Go>
    </li>
  );
}

export function NoServices({ children }: { children: ReactNode }) {
  return <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">{children}</p>;
}

export function ServiceGrid({ view, look, full }: { view: SiteView; look: LookTokens; full?: boolean }) {
  const shown = getShownServices(view.display, view.services as Service[]);
  if (shown.length === 0) return <NoServices>No services are shown on the website right now.</NoServices>;
  return (
    <ul className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3">
      {shown.map((service) => (
        <ServiceCard key={service.id} service={service} view={view} look={look} full={full} />
      ))}
    </ul>
  );
}

export function BookingGrid({ view, look }: { view: SiteView; look: LookTokens }) {
  const shown = getShownServices(view.display, view.services as Service[]);
  if (shown.length === 0) return <NoServices>No services are available to book online right now.</NoServices>;
  return (
    <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
      {shown.map((service) => {
        const href = bookingHrefIn(view, service.id);
        return (
          <li key={service.id}>
            <Go href={href} className={cn("flex h-full flex-col transition-colors hover:border-primary", look.raised, look.cardPad)}>
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-bold text-ink">{service.name}</span>
                <span className="shrink-0 text-xs font-semibold text-primary">{formatServicePrice(service.pricing)}</span>
              </span>
              <span className="mt-1 text-xs text-ink-muted">
                <ServiceFacts service={service} />
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

export function Hours({ view }: { view: SiteView }) {
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

export function ContactDetails({ view }: { view: SiteView }) {
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

export function InfoCard({ look, title, children, as: Level = "h3" }: { look: LookTokens; title: string; children: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className={cn(look.surface, look.cardPad)}>
      <Level className={look.infoTitle}>{title}</Level>
      {children}
    </div>
  );
}

/**
 * A message form. Nothing is delivered anywhere (there is no mail or text-message provider yet), so on the public site it says so and
 * points to the business's phone and email instead of claiming a message was sent. Inside the workspace (the signed-in preview) it keeps
 * the approved confirmation, which is a picture of the finished product.
 */
export function ContactForm({ view, look }: { view: SiteView; look: LookTokens }) {
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
    <form onSubmit={submit} noValidate className={cn("space-y-3", look.surface, look.formPad)}>
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
        <Input label="Full name" required autoComplete="name" error={errors.name} {...bind("name")} />
        <Input label="Phone (optional)" type="tel" autoComplete="tel" {...bind("phone")} />
      </div>
      <Input label="Email" type="email" required autoComplete="email" error={errors.email} {...bind("email")} />
      <Textarea label="Message" required error={errors.message} {...bind("message")} />
      <button type="submit" className={buttonClasses({ className: look.button })}>
        Send message
      </button>
    </form>
  );
}
