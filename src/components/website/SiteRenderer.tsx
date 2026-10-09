"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarCheck, ChevronRight, Clock, Headset, ListChecks, Mail, MapPin, Phone } from "lucide-react";
import { BrandMark } from "@/components/settings/BrandMark";
import { useBusiness, useHoursRows } from "@/components/settings/SettingsProvider";
import { buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { formatCityStateZip } from "@/data/fixtures";
import {
  BOOKING_METHOD_ACTION,
  BOOKING_METHOD_LABEL,
  formatDuration,
  formatServicePrice,
  type Service,
} from "@/data/services";
import { defaultPageContent, getShownServices, type PageId, type SiteContent } from "@/data/website";
import { cn } from "@/lib/cn";
import { toTelHref } from "@/lib/format";
import { previewHref } from "./site-links";
import { useServices } from "@/components/services/ServicesProvider";

/**
 * The customer-facing website, drawn from the saved content plus the shared records it is connected to:
 * business details from the Business fixture and every Service from the Services catalog. It is used twice,
 * identically: inside the page editor's canvas (inert, so nothing in it can be clicked) and as the public
 * preview pages. Sizes follow the width of the frame it sits in (container queries), which is what lets the
 * editor's Desktop / Mobile switch show a real narrow layout.
 */

type Props = {
  page: PageId;
  content: SiteContent;
  /** Keep following links on the published version (the preview's "live" view). */
  live?: boolean;
  /** Highlights one section (editor canvas). */
  activeSection?: string;
  /** A picture of the site inside a workspace page, which already has its own page heading: titles are level 2. */
  embedded?: boolean;
};

const NAV: readonly { page: PageId; label: string }[] = [
  { page: "services", label: "Services" },
  { page: "about", label: "About" },
  { page: "contact", label: "Contact" },
];

/** Section text, falling back to the standard copy when a value is missing. */
function useSectionValues(content: SiteContent, page: PageId) {
  const defaults = defaultPageContent(page);
  return (section: string) => ({ ...defaults[section]?.values, ...content.pages[page][section]?.values });
}

export function SiteHeader({ live }: { live?: boolean }) {
  const business = useBusiness();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-5 py-4 @xl:px-8">
      <Link href={previewHref("home", live)} className="flex items-center gap-2.5">
        <BrandMark className="size-8 rounded-btn text-sm" crest="A" />
        <span className="text-sm leading-tight font-bold text-ink">{business.name}</span>
      </Link>
      <nav aria-label="Website" className="flex items-center gap-x-5 gap-y-2 text-sm font-medium text-ink-muted">
        {NAV.map((item) => (
          <Link key={item.page} href={previewHref(item.page, live)} className="hover:text-ink">
            {item.label}
          </Link>
        ))}
        <Link href={previewHref("booking", live)} className={buttonClasses({ size: "sm" })}>
          Book service
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const business = useBusiness();
  return (
    <footer className="border-t border-line bg-surface px-5 py-5 text-center text-xs text-ink-muted @xl:px-8">
      © 2025 {business.name}. All rights reserved. | Powered by Climvia
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

function ServiceCard({ service, live, full }: { service: Service; live?: boolean; full?: boolean }) {
  // On the Services page the cards follow the page heading directly; elsewhere they sit under a section heading.
  const Name: "h2" | "h3" = full ? "h2" : "h3";
  return (
    <li className="flex flex-col rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <Name className="text-sm font-bold text-ink">{service.name}</Name>
        <span className="shrink-0 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">
          {formatServicePrice(service.pricing)}
        </span>
      </div>
      <p className={cn("mt-2 text-xs text-ink-muted", !full && "line-clamp-3")}>{service.description}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <Clock aria-hidden className="size-3.5" />
        {formatDuration(service.durationMinutes)} · {BOOKING_METHOD_LABEL[service.bookingMethod]}
      </p>
      <Link
        href={previewHref(`booking/${service.id}`, live)}
        className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4 self-start" })}
      >
        {BOOKING_METHOD_ACTION[service.bookingMethod]}
        <ChevronRight aria-hidden className="size-3.5" />
      </Link>
    </li>
  );
}

function ServiceGrid({ content, live, full }: { content: SiteContent; live?: boolean; full?: boolean }) {
  const { services: catalog } = useServices();
  const shown = getShownServices(content.services, catalog);
  if (shown.length === 0) {
    return <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No services are shown on the website right now.</p>;
  }
  return (
    <ul className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3">
      {shown.map((service) => (
        <ServiceCard key={service.id} service={service} live={live} full={full} />
      ))}
    </ul>
  );
}

function Hours() {
  const hours = useHoursRows();
  return (
    <ul className="space-y-1.5 text-sm">
      {hours.map((row) => (
        <li key={row.days} className="flex justify-between gap-6">
          <span className="font-medium text-ink">{row.days}</span>
          <span className="text-ink-muted">{row.hours}</span>
        </li>
      ))}
    </ul>
  );
}

function ContactDetails() {
  const business = useBusiness();
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

function BookingCta({ values, live, active }: { values: Record<string, string>; live?: boolean; active: boolean }) {
  return (
    <Section id="bookingCta" active={active} tone="brand">
      <div className="flex flex-col items-start justify-between gap-5 @2xl:flex-row @2xl:items-center">
        <Heading title={values.heading ?? ""} text={values.supportingText} tone="brand" />
        <Link
          href={previewHref("booking", live)}
          className="inline-flex shrink-0 items-center gap-2 rounded-btn bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-subtle"
        >
          {values.buttonLabel}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </Section>
  );
}

/** A message form that goes nowhere: the demo only shows the customer's confirmation. */
function ContactForm() {
  const business = useBusiness();
  const [sentTo, setSentTo] = useState<string>();
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "message", string>>>({});

  if (sentTo !== undefined) {
    return (
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

export function SiteRenderer({ page, content, live, activeSection, embedded }: Props) {
  const business = useBusiness();
  const { services: catalog } = useServices();
  const Title: "h1" | "h2" = embedded ? "h2" : "h1";
  const section = useSectionValues(content, page);
  const sections = content.pages[page];
  const show = (id: string) => sections[id]?.visible !== false;
  const on = (id: string) => activeSection === id;

  if (page === "home") {
    const hero = section("hero");
    const why = section("why");
    return (
      <>
        {show("hero") && (
          <Section id="hero" active={on("hero")} tone="brand" className="@xl:py-14">
            <div className={cn("max-w-2xl", hero.alignment === "center" && "mx-auto", alignClass(hero.alignment))}>
              <Title className="text-2xl font-bold tracking-tight @xl:text-4xl">{hero.headline}</Title>
              <p className="mt-3 text-sm text-white/85 @xl:text-base">{hero.supportingText}</p>
              <div className={cn("mt-6 flex flex-wrap gap-3", hero.alignment === "center" && "justify-center")}>
                <Link
                  href={previewHref("booking", live)}
                  className="inline-flex items-center rounded-btn bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-subtle"
                >
                  {hero.primaryCta}
                </Link>
                <Link
                  href={previewHref("services", live)}
                  className="inline-flex items-center rounded-btn border border-white/50 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
                >
                  {hero.secondaryCta}
                </Link>
              </div>
            </div>
          </Section>
        )}
        {show("services") && (
          <Section id="services" active={on("services")} tone="tinted">
            <Heading title={section("services").heading ?? ""} text={section("services").supportingText} />
            <ServiceGrid content={content} live={live} />
          </Section>
        )}
        {show("why") && (
          <Section id="why" active={on("why")}>
            <Heading title={why.heading ?? ""} />
            <Trio values={why} icons />
          </Section>
        )}
        {show("hours") && (
          <Section id="hours" active={on("hours")} tone="tinted">
            <InfoCard title="Business hours">
              <Hours />
            </InfoCard>
          </Section>
        )}
        {show("contact") && (
          <Section id="contact" active={on("contact")}>
            <InfoCard title="Contact us">
              <ContactDetails />
            </InfoCard>
          </Section>
        )}
        {show("bookingCta") && <BookingCta values={section("bookingCta")} live={live} active={on("bookingCta")} />}
      </>
    );
  }

  if (page === "services") {
    const intro = section("intro");
    return (
      <>
        {show("intro") && (
          <Section id="intro" active={on("intro")} tone="tinted">
            <div className={cn("max-w-2xl", intro.alignment === "center" && "mx-auto", alignClass(intro.alignment))}>
              <Title className="text-2xl font-bold tracking-tight text-ink @xl:text-3xl">{intro.heading}</Title>
              <p className="mt-2 text-sm text-ink-muted @xl:text-base">{intro.supportingText}</p>
            </div>
          </Section>
        )}
        {show("catalog") && (
          <Section id="catalog" active={on("catalog")}>
            <ServiceGrid content={content} live={live} full />
          </Section>
        )}
        {show("bookingCta") && <BookingCta values={section("bookingCta")} live={live} active={on("bookingCta")} />}
      </>
    );
  }

  if (page === "about") {
    const intro = section("intro");
    const biz = section("business");
    const values = section("values");
    return (
      <>
        {show("intro") && (
          <Section id="intro" active={on("intro")} tone="tinted">
            <div className={cn("max-w-2xl", intro.alignment === "center" && "mx-auto", alignClass(intro.alignment))}>
              <Title className="text-2xl font-bold tracking-tight text-ink @xl:text-3xl">{intro.heading}</Title>
              <p className="mt-2 text-sm text-ink-muted @xl:text-base">{intro.supportingText}</p>
            </div>
          </Section>
        )}
        {show("business") && (
          <Section id="business" active={on("business")}>
            <Heading title={biz.heading ?? ""} text={biz.body} />
          </Section>
        )}
        {show("values") && (
          <Section id="values" active={on("values")} tone="tinted">
            <Heading title={values.heading ?? ""} text={values.supportingText} />
            <Trio values={values} icons={false} />
          </Section>
        )}
        {show("details") && (
          <Section id="details" active={on("details")}>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              <InfoCard title={business.name}>
                <ContactDetails />
              </InfoCard>
              <InfoCard title="Business hours">
                <Hours />
              </InfoCard>
            </div>
          </Section>
        )}
        {show("bookingCta") && <BookingCta values={section("bookingCta")} live={live} active={on("bookingCta")} />}
      </>
    );
  }

  if (page === "contact") {
    const intro = section("intro");
    const form = section("form");
    return (
      <>
        {show("intro") && (
          <Section id="intro" active={on("intro")} tone="tinted">
            <div className={cn("max-w-2xl", intro.alignment === "center" && "mx-auto", alignClass(intro.alignment))}>
              <Title className="text-2xl font-bold tracking-tight text-ink @xl:text-3xl">{intro.heading}</Title>
              <p className="mt-2 text-sm text-ink-muted @xl:text-base">{intro.supportingText}</p>
            </div>
          </Section>
        )}
        {show("details") && (
          <Section id="details" active={on("details")}>
            <InfoCard title="Contact details" as="h2">
              <ContactDetails />
            </InfoCard>
          </Section>
        )}
        {show("hours") && (
          <Section id="hours" active={on("hours")} tone="tinted">
            <InfoCard title="Business hours" as="h2">
              <Hours />
            </InfoCard>
          </Section>
        )}
        {show("form") && (
          <Section id="form" active={on("form")} tone="tinted">
            <Heading title={form.heading ?? ""} text={form.supportingText} />
            <div className="mt-5 max-w-xl">
              <ContactForm />
            </div>
          </Section>
        )}
        {show("bookingCta") && <BookingCta values={section("bookingCta")} live={live} active={on("bookingCta")} />}
      </>
    );
  }

  const intro = section("intro");
  const alt = section("alternative");
  const shown = getShownServices(content.services, catalog);
  return (
    <>
      {show("intro") && (
        <Section id="intro" active={on("intro")} tone="tinted">
          <div className={cn("max-w-2xl", intro.alignment === "center" && "mx-auto", alignClass(intro.alignment))}>
            <Title className="text-2xl font-bold tracking-tight text-ink @xl:text-3xl">{intro.heading}</Title>
            <p className="mt-2 text-sm text-ink-muted @xl:text-base">{intro.supportingText}</p>
          </div>
        </Section>
      )}
      {show("experience") && (
        <Section id="experience" active={on("experience")}>
          {shown.length === 0 ? (
            <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No services are available to book online right now.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {shown.map((service) => (
                <li key={service.id}>
                  <Link
                    href={previewHref(`booking/${service.id}`, live)}
                    className="flex h-full flex-col rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-primary"
                  >
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
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {show("alternative") && (
        <Section id="alternative" active={on("alternative")} tone="tinted">
          <Heading title={alt.heading ?? ""} text={alt.supportingText} />
          <div className="mt-4 max-w-sm">
            <InfoCard title="Contact us">
              <ContactDetails />
            </InfoCard>
          </div>
        </Section>
      )}
    </>
  );
}
