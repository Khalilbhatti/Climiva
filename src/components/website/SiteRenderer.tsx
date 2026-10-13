"use client";

import { ArrowRight, CalendarCheck, Headset, ListChecks } from "lucide-react";
import { orderedSections, type PageModel, type SectionModel } from "@/data/website";
import { cn } from "@/lib/cn";
import { ServiceCollection } from "./SiteServices";
import { CtaBand, CtaEditorial, CtaPanel, FeatureNumbered, FeatureReassure, FeatureStrip, HeroEditorial, HeroSplit, HeroWelcome } from "./SiteVariants";
import { BookingGrid, ContactDetails, ContactForm, Go, Heading, Hours, InfoCard, Intro, Section, ServiceGrid, alignClass } from "./site-primitives";
import { looksOf, type LookTokens } from "./site-look";
import { fillProps, typeHrefIn, type SiteView } from "./site-view";

export { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * The customer-facing website, drawn from a page's SECTIONS plus the records it is connected to. Each section is a row of data
 * (a registered type, a variant and plain-text properties, see lib/site-sections); this file holds the one switch that draws each
 * registered type and variant. Nothing here knows a page by name, and nothing is read from a section except the properties its type declares.
 *
 * It is used identically for the Draft (the editor's inert canvas, the Overview's picture, the signed-in preview) and for the Published
 * site a visitor opens, and for a Template's preview: the same renderer, fed by the same shape (`SiteView`) from different sources. Sizes
 * follow the width of the frame it sits in (container queries), which is what lets the editor's Desktop / Mobile switch show a real narrow
 * layout. The design style of the site (`theme.look`, see ./site-look) decides the chrome of every section; the variant decides its structure.
 */

type Props = {
  page: PageModel;
  view: SiteView;
  /** Highlights one section (editor canvas). */
  activeSection?: string;
  /** A picture of the site inside a workspace page, which already has its own page heading: titles are level 2. */
  embedded?: boolean;
};

function Trio({ look, values, icons }: { look: LookTokens; values: Record<string, string>; icons: boolean }) {
  const ICONS = [ListChecks, CalendarCheck, Headset];
  return (
    <ul className="mt-6 grid grid-cols-1 gap-4 @2xl:grid-cols-3">
      {[1, 2, 3].map((n, index) => {
        const Icon = ICONS[index];
        return (
          <li key={n} className={cn(look.surface, look.cardPad)}>
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
 * One registered section, drawn. An unknown type or variant draws nothing (it never reaches here: the loaders drop them). `primary` marks
 * the section that carries the page's one level-1 heading (the first hero or page heading on the page); any other title is level 2, so a
 * page that has two of them still has one h1.
 */
export function SiteSection({ section, view, active = false, embedded, primary = true }: { section: SectionModel; view: SiteView; active?: boolean; embedded?: boolean; primary?: boolean }) {
  const values = fillProps(section.props, view.business);
  const Title: "h1" | "h2" = embedded || !primary ? "h2" : "h1";
  const id = section.key;
  const look = looksOf(view.theme);
  const common = { id, active, look, values, view };

  switch (section.type) {
    case "hero":
      if (section.variant === "split") return <HeroSplit {...common} Title={Title} />;
      if (section.variant === "welcome") return <HeroWelcome {...common} Title={Title} />;
      if (section.variant === "editorial") return <HeroEditorial {...common} Title={Title} />;
      return (
        <Section id={id} active={active} tone="brand" look={look} className={look.heroPad}>
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
        <Section id={id} active={active} tone="tinted" look={look}>
          <Intro look={look} values={values} Title={Title} />
        </Section>
      );
    case "service_list":
      switch (section.variant) {
        case "booking":
          return (
            <Section id={id} active={active} look={look}>
              <BookingGrid view={view} look={look} />
            </Section>
          );
        case "catalog":
          return (
            <Section id={id} active={active} look={look}>
              <ServiceGrid view={view} look={look} full />
            </Section>
          );
        case "grid":
        case "friendly":
        case "rows":
          return (
            <Section id={id} active={active} tone={section.variant === "rows" ? "plain" : "tinted"} look={look}>
              <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
              <ServiceCollection presentation={section.variant} view={view} look={look} />
            </Section>
          );
        case "grid-catalog":
        case "friendly-catalog":
        case "rows-catalog":
          return (
            <Section id={id} active={active} look={look}>
              <ServiceCollection presentation={section.variant === "grid-catalog" ? "grid" : section.variant === "friendly-catalog" ? "friendly" : "rows"} view={view} look={look} full />
            </Section>
          );
        default:
          return (
            <Section id={id} active={active} tone="tinted" look={look}>
              <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
              <ServiceGrid view={view} look={look} />
            </Section>
          );
      }
    case "feature_list":
      switch (section.variant) {
        case "strip":
          return <FeatureStrip id={id} active={active} look={look} values={values} />;
        case "numbered":
          return <FeatureNumbered id={id} active={active} look={look} values={values} />;
        case "reassure":
          return <FeatureReassure id={id} active={active} look={look} values={values} />;
        case "icons":
          return (
            <Section id={id} active={active} look={look}>
              <Heading look={look} title={values.heading ?? ""} />
              <Trio look={look} values={values} icons />
            </Section>
          );
        default:
          return (
            <Section id={id} active={active} tone="tinted" look={look}>
              <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
              <Trio look={look} values={values} icons={false} />
            </Section>
          );
      }
    case "rich_text":
      return (
        <Section id={id} active={active} look={look}>
          <Heading look={look} title={values.heading ?? ""} text={values.body} />
        </Section>
      );
    case "business_hours":
      return (
        <Section id={id} active={active} tone="tinted" look={look}>
          <InfoCard look={look} title="Business hours" as={section.variant === "page" ? "h2" : "h3"}>
            <Hours view={view} />
          </InfoCard>
        </Section>
      );
    case "contact_details":
      if (section.variant === "callout") {
        return (
          <Section id={id} active={active} tone="tinted" look={look}>
            <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
            <div className="mt-4 max-w-sm">
              <InfoCard look={look} title="Contact us">
                <ContactDetails view={view} />
              </InfoCard>
            </div>
          </Section>
        );
      }
      return (
        <Section id={id} active={active} look={look}>
          <InfoCard look={look} title={section.variant === "page" ? "Contact details" : "Contact us"} as={section.variant === "page" ? "h2" : "h3"}>
            <ContactDetails view={view} />
          </InfoCard>
        </Section>
      );
    case "business_details":
      return (
        <Section id={id} active={active} look={look}>
          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
            {/* Level 2: this section can be the first thing under a page's heading (the Contact page of a Template), and a level 3 there skips one. */}
            <InfoCard look={look} title={view.business.name} as="h2">
              <ContactDetails view={view} />
            </InfoCard>
            <InfoCard look={look} title="Business hours" as="h2">
              <Hours view={view} />
            </InfoCard>
          </div>
        </Section>
      );
    case "contact_form":
      return (
        <Section id={id} active={active} tone="tinted" look={look}>
          <Heading look={look} title={values.heading ?? ""} text={values.supportingText} />
          <div className="mt-5 max-w-xl">
            <ContactForm view={view} look={look} />
          </div>
        </Section>
      );
    case "call_to_action":
      if (section.variant === "band") return <CtaBand {...common} />;
      if (section.variant === "panel") return <CtaPanel {...common} />;
      if (section.variant === "editorial") return <CtaEditorial {...common} />;
      return (
        <Section id={id} active={active} tone="brand" look={look}>
          <div className="flex flex-col items-start justify-between gap-5 @2xl:flex-row @2xl:items-center">
            <Heading look={look} title={values.heading ?? ""} text={values.supportingText} tone="brand" />
            <Go
              href={typeHrefIn(view, "booking")}
              className={cn("inline-flex shrink-0 items-center gap-2 rounded-btn bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary-subtle", look.button)}
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
