import { EMPTY_SERVICE_DISPLAY } from "@/data/website";
import { TEMPLATE_SCHEMA, type TemplateDefinition } from "@/lib/site-template";
import { THEME_SCHEMA } from "@/lib/site-theme";

/**
 * Comfort: a warm, welcoming website for a business that serves people's homes.
 *
 * Its composition differs from the other Templates in what is on the page and in what order:
 *   - the home page opens on a WELCOMING opening with a booking button and a way to call, not a banner or a contact panel;
 *   - the reassurance is one soft rounded panel, followed by FRIENDLY service cards (an icon, the full description, a booking button);
 *   - a short prompt about seasonal maintenance sits between the services and the contact;
 *   - the Contact page leads with a "talk to us" block and puts the hours last, the Booking page adds a "before you book" reassurance, and every
 *     page closes on a centered panel with a phone link.
 * Its theme is a burnt-orange accent, round corners, comfortable spacing, a classic serif for headings and the "comfort" look (a narrower,
 * roomier layout, soft surfaces, a rounded header and a centered footer).
 *
 * Application-owned product content: no business is named (the name and place come from text tokens, contact details and hours from the
 * organization's record, Services from its catalog), and nothing here is a claim about a business (no years, awards, reviews,
 * certifications or guarantees). It describes what the website does and is meant to be edited.
 */
export const COMFORT_TEMPLATE_KEY = "comfort";
export const COMFORT_TEMPLATE_NAME = "Comfort";
export const COMFORT_TEMPLATE_DESCRIPTION = "A warm, welcoming layout for home service, with friendly cards, a reassurance panel and a clear booking path.";

const BOOKING_PANEL = { type: "call_to_action", variant: "panel", visible: true } as const;

export const COMFORT_TEMPLATE: TemplateDefinition = {
  schema: TEMPLATE_SCHEMA,
  theme: { schema: THEME_SCHEMA, accent: "#9A3412", radius: "large", density: "comfortable", headingFont: "serif", bodyFont: "inter", look: "comfort" },
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
          label: "Welcome",
          type: "hero",
          variant: "welcome",
          visible: true,
          props: {
            headline: "Heating and cooling that keeps your home comfortable.",
            supportingText: "Book maintenance, repairs and seasonal tune-ups with {{business.name}}, at a time that suits your household.",
            primaryCta: "Book service",
            secondaryCta: "View services",
          },
        },
        {
          key: "expect",
          label: "What to expect",
          type: "feature_list",
          variant: "reassure",
          visible: true,
          props: {
            heading: "What to expect when you book",
            supportingText: "Booking with {{business.name}} is simple and clear.",
            item1Title: "Choose your service",
            item1Text: "See each service and its price before you book.",
            item2Title: "Pick a time",
            item2Text: "Select a time that fits around your day.",
            item3Title: "Get help close to home",
            item3Text: "A local team serving {{business.location}}.",
          },
        },
        {
          key: "services",
          label: "Services",
          type: "service_list",
          variant: "friendly",
          visible: true,
          props: { heading: "Our services", supportingText: "Heating, cooling and seasonal care for your home. Choose a service to see what it includes." },
        },
        {
          key: "maintenance",
          label: "Seasonal maintenance",
          type: "rich_text",
          variant: "default",
          visible: true,
          props: {
            heading: "Seasonal maintenance",
            body: "Ask about a maintenance visit before the weather turns. Choose it from our services and book it online.",
          },
        },
        {
          key: "contact",
          label: "We are here to help",
          type: "contact_details",
          variant: "callout",
          visible: true,
          props: { heading: "We are here to help", supportingText: "Call or email {{business.name}} with any question about your home comfort." },
        },
        {
          key: "bookingCta",
          label: "Booking panel",
          ...BOOKING_PANEL,
          props: { heading: "Ready to schedule service?", supportingText: "Choose a service and a time that works for your household.", buttonLabel: "Book service" },
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
          props: { heading: "Our services", supportingText: "Heating, cooling and maintenance for your home from {{business.name}}.", alignment: "center" },
        },
        { key: "catalog", label: "Service cards", type: "service_list", variant: "friendly-catalog", visible: true, props: {} },
        {
          key: "help",
          label: "Not sure what you need",
          type: "rich_text",
          variant: "default",
          visible: true,
          props: {
            heading: "Not sure what you need?",
            body: "Describe the problem when you book, or choose a maintenance visit to start. You can also call or email us first.",
          },
        },
        {
          key: "bookingCta",
          label: "Booking panel",
          ...BOOKING_PANEL,
          props: { heading: "Ready to book?", supportingText: "Choose a service and request a time that suits you.", buttonLabel: "Book service" },
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
          props: { heading: "About {{business.name}}", supportingText: "Who we are and how we work.", alignment: "center" },
        },
        {
          key: "approach",
          label: "Our approach",
          type: "rich_text",
          variant: "default",
          visible: true,
          props: {
            heading: "Our approach",
            body: "{{business.name}} provides heating, cooling and maintenance services in {{business.location}}. We want booking and service to be clear and easy for every household.",
          },
        },
        {
          key: "values",
          label: "What matters to us",
          type: "feature_list",
          variant: "reassure",
          visible: true,
          props: {
            heading: "What matters to us",
            supportingText: "Standards we apply to every visit.",
            item1Title: "Clear communication",
            item1Text: "Explain options and next steps in plain words.",
            item2Title: "Convenient scheduling",
            item2Text: "Make it easy to request or book a visit.",
            item3Title: "Careful visits",
            item3Text: "Plan each visit around your household.",
          },
        },
        {
          key: "contact",
          label: "Talk to us",
          type: "contact_details",
          variant: "callout",
          visible: true,
          props: { heading: "Talk to us", supportingText: "Call or email {{business.name}} to ask about our services." },
        },
        {
          key: "bookingCta",
          label: "Booking panel",
          ...BOOKING_PANEL,
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
          props: { heading: "Contact {{business.name}}", supportingText: "We would be glad to hear from you.", alignment: "center" },
        },
        {
          key: "talk",
          label: "Talk to us",
          type: "contact_details",
          variant: "callout",
          visible: true,
          props: { heading: "Talk to us", supportingText: "Call or email {{business.name}}, or book a service online." },
        },
        {
          key: "form",
          label: "Contact form",
          type: "contact_form",
          variant: "default",
          visible: true,
          props: { heading: "Send us a message", supportingText: "Tell us what you need. You can also call or email using the details above." },
        },
        { key: "hours", label: "Business hours", type: "business_hours", variant: "page", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking panel",
          ...BOOKING_PANEL,
          props: { heading: "Ready to schedule HVAC service?", supportingText: "Choose a service and request or book a time.", buttonLabel: "Book service" },
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
          props: { heading: "Book your visit", supportingText: "Choose a service and follow the booking steps to request or schedule your visit.", alignment: "center" },
        },
        { key: "experience", label: "Booking options", type: "service_list", variant: "booking", visible: true, props: {} },
        {
          key: "before",
          label: "Before you book",
          type: "feature_list",
          variant: "reassure",
          visible: true,
          props: {
            heading: "Before you book",
            supportingText: "A few things to know.",
            item1Title: "Choose your service",
            item1Text: "Each service shows its price and how it is booked.",
            item2Title: "Pick a time",
            item2Text: "Request or select a time that suits your household.",
            item3Title: "Ask us anything",
            item3Text: "Call or email {{business.name}} if you have a question first.",
          },
        },
      ],
    },
  ],
};
