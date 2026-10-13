import { EMPTY_SERVICE_DISPLAY } from "@/data/website";
import { TEMPLATE_SCHEMA, type TemplateDefinition } from "@/lib/site-template";
import { THEME_SCHEMA } from "@/lib/site-theme";

/**
 * Airflow: an editorial, spacious website for a business that wants to look considered and calm.
 *
 * Its composition differs from the other Templates in what is on the page and in what order:
 *   - the home page opens on a very large EDITORIAL headline with its introduction set beside it and two quiet links under a rule;
 *   - Services are index-style ROWS (a large name, a short description, the price and a link), not boxes;
 *   - "how it works" is three NUMBERED steps with no boxes around them;
 *   - the Contact page leads with the hours, then the contact details, then the form, the Booking page adds three numbered "what happens next"
 *     steps, and every page closes on a large statement with a single booking button.
 * Its theme is graphite, pill-shaped buttons, comfortable spacing, a light weight for headings and the "airflow" look (a wide
 * margin-heavy layout, no card chrome, a wordmark header and a large-name footer).
 *
 * Application-owned product content: no business is named (the name and place come from text tokens, contact details and hours from the
 * organization's record, Services from its catalog), and nothing here is a claim about a business (no years, awards, reviews,
 * certifications or guarantees). It describes what the website does and is meant to be edited.
 */
export const AIRFLOW_TEMPLATE_KEY = "airflow";
export const AIRFLOW_TEMPLATE_NAME = "Airflow";
export const AIRFLOW_TEMPLATE_DESCRIPTION = "An editorial, spacious layout with large type, index-style services and very little chrome.";

const CLOSING = { type: "call_to_action", variant: "editorial", visible: true } as const;

export const AIRFLOW_TEMPLATE: TemplateDefinition = {
  schema: TEMPLATE_SCHEMA,
  theme: { schema: THEME_SCHEMA, accent: "#27272A", radius: "medium", density: "comfortable", headingFont: "inter", bodyFont: "inter", look: "airflow" },
  settings: { serviceDisplay: { order: [...EMPTY_SERVICE_DISPLAY.order], hidden: [...EMPTY_SERVICE_DISPLAY.hidden] } },
  pages: [
    {
      key: "home",
      title: "Home",
      slug: "",
      type: "home",
      visible: true,
      sections: [
        {
          key: "hero",
          label: "Opening",
          type: "hero",
          variant: "editorial",
          visible: true,
          props: {
            headline: "Heating and cooling service you can count on.",
            supportingText: "Book maintenance, repairs and installations with {{business.name}}, online and at a time that suits you.",
            primaryCta: "Book service",
            secondaryCta: "View services",
          },
        },
        {
          key: "services",
          label: "Services",
          type: "service_list",
          variant: "rows",
          visible: true,
          props: { heading: "Services", supportingText: "Choose a service to see what it includes." },
        },
        {
          key: "how",
          label: "How it works",
          type: "feature_list",
          variant: "numbered",
          visible: true,
          props: {
            heading: "How it works",
            supportingText: "Three steps from first look to booked visit.",
            item1Title: "Choose a service",
            item1Text: "Browse the services the business offers and their prices.",
            item2Title: "Pick a time",
            item2Text: "Request or book a visit online in a few steps.",
            item3Title: "Get service",
            item3Text: "The business confirms your visit and arrives at the scheduled time.",
          },
        },
        { key: "details", label: "Contact and hours", type: "business_details", variant: "default", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Closing statement",
          ...CLOSING,
          props: { heading: "Ready when you are.", supportingText: "Choose a service and a time that suits you.", buttonLabel: "Book service" },
        },
      ],
    },
    {
      key: "services",
      title: "Services",
      slug: "services",
      type: "services",
      visible: true,
      sections: [
        {
          key: "intro",
          label: "Page intro",
          type: "page_intro",
          variant: "default",
          visible: true,
          props: { heading: "Services", supportingText: "Maintenance, diagnostics, repair and installation from {{business.name}}.", alignment: "left" },
        },
        { key: "catalog", label: "Service rows", type: "service_list", variant: "rows-catalog", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Closing statement",
          ...CLOSING,
          props: { heading: "Not sure which service?", supportingText: "Contact {{business.name}} before you book.", buttonLabel: "Book service" },
        },
      ],
    },
    {
      key: "about",
      title: "About",
      slug: "about",
      type: "content",
      visible: true,
      sections: [
        {
          key: "intro",
          label: "Page intro",
          type: "page_intro",
          variant: "default",
          visible: true,
          props: { heading: "About {{business.name}}", supportingText: "How we work, in a few words.", alignment: "left" },
        },
        {
          key: "approach",
          label: "Our approach",
          type: "rich_text",
          variant: "default",
          visible: true,
          props: {
            heading: "Our approach",
            body: "{{business.name}} provides HVAC maintenance, diagnostics, repair and installation services in {{business.location}}. Booking and service should be clear from the first click to the last visit.",
          },
        },
        {
          key: "values",
          label: "What matters to us",
          type: "feature_list",
          variant: "numbered",
          visible: true,
          props: {
            heading: "What matters to us",
            supportingText: "Three things we keep in mind on every visit.",
            item1Title: "Clear communication",
            item1Text: "Explain options and next steps clearly.",
            item2Title: "Practical scheduling",
            item2Text: "Make it easy to request or book a visit.",
            item3Title: "Organized records",
            item3Text: "Keep service information connected from booking to visit.",
          },
        },
        { key: "details", label: "Contact and hours", type: "business_details", variant: "default", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Closing statement",
          ...CLOSING,
          props: { heading: "Need HVAC service?", supportingText: "View the available services and book a time that works for you.", buttonLabel: "Book service" },
        },
      ],
    },
    {
      key: "contact",
      title: "Contact",
      slug: "contact",
      type: "contact",
      visible: true,
      sections: [
        {
          key: "intro",
          label: "Page intro",
          type: "page_intro",
          variant: "default",
          visible: true,
          props: { heading: "Contact {{business.name}}", supportingText: "Hours, phone and a way to write to us.", alignment: "left" },
        },
        { key: "hours", label: "Business hours", type: "business_hours", variant: "page", visible: true, props: {} },
        { key: "details", label: "Contact details", type: "contact_details", variant: "page", visible: true, props: {} },
        {
          key: "form",
          label: "Contact form",
          type: "contact_form",
          variant: "default",
          visible: true,
          props: { heading: "Send us a message", supportingText: "Tell us what you need. You can also call or email using the details above." },
        },
        {
          key: "bookingCta",
          label: "Closing statement",
          ...CLOSING,
          props: { heading: "Ready to schedule?", supportingText: "Choose a service and request or book a time.", buttonLabel: "Book service" },
        },
      ],
    },
    {
      key: "booking",
      title: "Booking",
      slug: "booking",
      type: "booking",
      visible: true,
      sections: [
        {
          key: "intro",
          label: "Page intro",
          type: "page_intro",
          variant: "default",
          visible: true,
          props: { heading: "Book service", supportingText: "Choose a service and follow the booking steps to request or schedule your visit.", alignment: "left" },
        },
        { key: "experience", label: "Booking options", type: "service_list", variant: "booking", visible: true, props: {} },
        {
          key: "next",
          label: "What happens next",
          type: "feature_list",
          variant: "numbered",
          visible: true,
          props: {
            heading: "What happens next",
            supportingText: "Three steps after you choose a service.",
            item1Title: "Choose a service",
            item1Text: "Pick the service you need from the list above.",
            item2Title: "Pick a time",
            item2Text: "Request or select a time in the booking steps.",
            item3Title: "Get confirmation",
            item3Text: "The business confirms your visit with you.",
          },
        },
      ],
    },
  ],
};
