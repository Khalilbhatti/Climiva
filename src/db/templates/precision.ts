import { EMPTY_SERVICE_DISPLAY } from "@/data/website";
import { TEMPLATE_SCHEMA, type TemplateDefinition } from "@/lib/site-template";
import { THEME_SCHEMA } from "@/lib/site-theme";

/**
 * Precision: a structured, confident website for a service company that wants its information laid out clearly.
 *
 * Its composition differs from the other Templates in what is on the page and in what order, not only in how it is drawn:
 *   - the home page opens on a SPLIT opening, a headline beside a panel with the business's phone number and hours;
 *   - the reassurance is one ruled TRUST STRIP rather than three boxes;
 *   - Services are a ruled GRID with the price, duration and booking method in labelled cells;
 *   - the contact and the hours sit side by side in one card, and every page closes on a BAND with a booking button and the phone number.
 * Its theme is a deep blue, sharp corners, compact spacing and the "precision" look (a bounded layout, a contact strip in the header and a
 * three-column footer).
 *
 * Application-owned product content. It names no business: the name and place come from the text tokens, the contact details and hours
 * from the organization's record, the Services from its catalog. Nothing here is a claim about a business (no years, awards, reviews,
 * certifications or guarantees); the copy describes what the website itself does, and is meant to be edited.
 */
export const PRECISION_TEMPLATE_KEY = "precision";
export const PRECISION_TEMPLATE_NAME = "Precision";
export const PRECISION_TEMPLATE_DESCRIPTION = "A structured, confident layout with a contact panel, a ruled service grid and clear booking buttons.";

const BOOKING_BAND = { type: "call_to_action", variant: "band", visible: true } as const;

export const PRECISION_TEMPLATE: TemplateDefinition = {
  schema: TEMPLATE_SCHEMA,
  theme: { schema: THEME_SCHEMA, accent: "#1E40AF", radius: "small", density: "compact", headingFont: "inter", bodyFont: "inter", look: "precision" },
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
          variant: "split",
          visible: true,
          props: {
            headline: "Clear, scheduled heating and cooling service.",
            supportingText: "See what {{business.name}} offers, choose a service and book a visit online.",
            primaryCta: "Book service",
            secondaryCta: "View services",
          },
        },
        {
          key: "expect",
          label: "What to expect",
          type: "feature_list",
          variant: "strip",
          visible: true,
          props: {
            heading: "What to expect",
            item1Title: "Clear service options",
            item1Text: "See each service with its price and booking option before you book.",
            item2Title: "Online scheduling",
            item2Text: "Book or request a time online in a few steps, from any device.",
            item3Title: "Local support",
            item3Text: "Heating and cooling service in {{business.location}}.",
          },
        },
        {
          key: "services",
          label: "Services",
          type: "service_list",
          variant: "grid",
          visible: true,
          props: { heading: "Services", supportingText: "Choose a service to see its price, duration and how to book it." },
        },
        { key: "details", label: "Contact and hours", type: "business_details", variant: "default", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking band",
          ...BOOKING_BAND,
          props: { heading: "Ready to schedule service?", supportingText: "Choose a service and request or book a time.", buttonLabel: "Book service" },
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
          props: {
            heading: "HVAC services",
            supportingText: "Maintenance, diagnostics, repair and installation from {{business.name}}. Compare services and book the one you need.",
            alignment: "left",
          },
        },
        { key: "catalog", label: "Service grid", type: "service_list", variant: "grid-catalog", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking band",
          ...BOOKING_BAND,
          props: { heading: "Questions before you book?", supportingText: "Contact {{business.name}} and ask before you choose a service.", buttonLabel: "Book service" },
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
          props: { heading: "About {{business.name}}", supportingText: "How we work and what you can expect from us.", alignment: "left" },
        },
        {
          key: "approach",
          label: "Our approach",
          type: "rich_text",
          variant: "default",
          visible: true,
          props: {
            heading: "Our approach",
            body: "{{business.name}} provides HVAC maintenance, diagnostics, repair and installation services in {{business.location}}. Tell us what you need and we will point you to the right service.",
          },
        },
        {
          key: "standards",
          label: "Our standards",
          type: "feature_list",
          variant: "strip",
          visible: true,
          props: {
            heading: "Our standards",
            item1Title: "Clear communication",
            item1Text: "Explain service options and next steps clearly.",
            item2Title: "Practical scheduling",
            item2Text: "Make it easy to request or book service.",
            item3Title: "Organized records",
            item3Text: "Keep service information connected from booking to visit.",
          },
        },
        { key: "details", label: "Contact and hours", type: "business_details", variant: "default", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking band",
          ...BOOKING_BAND,
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
          props: { heading: "Contact {{business.name}}", supportingText: "Call, write or book a service online.", alignment: "left" },
        },
        { key: "details", label: "Contact and hours", type: "business_details", variant: "default", visible: true, props: {} },
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
          label: "Booking band",
          ...BOOKING_BAND,
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
          props: { heading: "Book HVAC service", supportingText: "Choose a service and follow the booking steps to request or schedule your visit.", alignment: "left" },
        },
        { key: "experience", label: "Booking options", type: "service_list", variant: "booking", visible: true, props: {} },
        { key: "details", label: "Contact and hours", type: "business_details", variant: "default", visible: true, props: {} },
      ],
    },
  ],
};
