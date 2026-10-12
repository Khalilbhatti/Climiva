/**
 * The one site template Phase 15 ships: the approved five-page Climvia website (Home, Services, About, Contact, Booking).
 *
 * This is the application's own definition. It is written into `site_templates` by a MIGRATION (0013), never by a tenant: the runtime
 * role can read an active template and nothing more. A test keeps this constant and that migrated row identical, so there is one
 * template and not two.
 *
 * Its copy is the approved copy of the website, with the three places that named the sample business replaced by the two text tokens a
 * section may hold ({{business.name}}, {{business.location}}): they are filled from the organization when the page is drawn, so a new
 * business gets a website that speaks of itself, a rename is followed without republishing, and no section holds the business's identity.
 *
 * Server and tooling code only (the migration generator, the seed, the Site queries): it is not imported by a Client Component, so
 * the copy is sent to a browser only as the business's own Draft, never as a constant in the JavaScript.
 */
import { DEFAULT_THEME } from "@/lib/site-theme";
import { EMPTY_SERVICE_DISPLAY } from "@/data/website";
import { TEMPLATE_SCHEMA, type TemplateDefinition } from "@/lib/site-template";

export const DEFAULT_TEMPLATE_KEY = "climvia-starter";
export const DEFAULT_TEMPLATE_NAME = "Climvia starter";
export const DEFAULT_TEMPLATE_CATEGORY = "hvac";
export const DEFAULT_TEMPLATE_DESCRIPTION = "A five-page website for an HVAC business: Home, Services, About, Contact and Booking.";

export const DEFAULT_TEMPLATE: TemplateDefinition = {
  schema: TEMPLATE_SCHEMA,
  theme: DEFAULT_THEME,
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
          label: "Hero",
          type: "hero",
          variant: "default",
          visible: true,
          props: {
            headline: "Heating & cooling service when you need it.",
            supportingText: "Book HVAC maintenance, diagnostics, and repair services with {{business.name}}.",
            primaryCta: "Book service",
            secondaryCta: "View services",
            alignment: "left",
          },
        },
        {
          key: "services",
          label: "Services",
          type: "service_list",
          variant: "cards",
          visible: true,
          props: { heading: "Our HVAC Services", supportingText: "Choose a service to view details and booking options." },
        },
        {
          key: "why",
          label: "Why choose us",
          type: "feature_list",
          variant: "icons",
          visible: true,
          props: {
            heading: "Why customers choose {{business.name}}",
            item1Title: "Clear service options",
            item1Text: "See each service with its price and booking option before you book.",
            item2Title: "Convenient online booking",
            item2Text: "Book or request a time online in a few steps, from any device.",
            item3Title: "Local customer support",
            item3Text: "Heating and cooling specialists serving {{business.location}}.",
          },
        },
        { key: "hours", label: "Business hours", type: "business_hours", variant: "card", visible: true, props: {} },
        { key: "contact", label: "Contact", type: "contact_details", variant: "card", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking CTA",
          type: "call_to_action",
          variant: "default",
          visible: true,
          props: {
            heading: "Ready to schedule service?",
            supportingText: "Select an inspection, heating repair, or seasonal cooling tune-up online in a few minutes.",
            buttonLabel: "Book service",
          },
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
            heading: "HVAC Services",
            supportingText: "Explore maintenance, diagnostics, repair, and installation Services available from {{business.name}}.",
            alignment: "left",
          },
        },
        { key: "catalog", label: "Service catalog", type: "service_list", variant: "catalog", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking CTA",
          type: "call_to_action",
          variant: "default",
          visible: true,
          props: { heading: "Need HVAC service?", supportingText: "Choose a service and request a time that works for you.", buttonLabel: "Book service" },
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
          props: {
            heading: "About {{business.name}}",
            supportingText: "Learn more about our approach to HVAC service and the customers we serve.",
            alignment: "left",
          },
        },
        {
          key: "business",
          label: "Our business",
          type: "rich_text",
          variant: "default",
          visible: true,
          props: {
            heading: "Our business",
            body: "{{business.name}} provides HVAC maintenance, diagnostics, repair, and installation services in {{business.location}}.",
          },
        },
        {
          key: "values",
          label: "What matters to us",
          type: "feature_list",
          variant: "plain",
          visible: true,
          props: {
            heading: "What matters to us",
            supportingText: "Core standards applied across every scheduled appointment.",
            item1Title: "Clear communication",
            item1Text: "Explain service options and next steps clearly.",
            item2Title: "Practical scheduling",
            item2Text: "Make it easy for customers to request or book service.",
            item3Title: "Organized service records",
            item3Text: "Keep property and service information connected throughout the customer experience.",
          },
        },
        { key: "details", label: "Business details", type: "business_details", variant: "default", visible: true, props: {} },
        {
          key: "bookingCta",
          label: "Booking CTA",
          type: "call_to_action",
          variant: "default",
          visible: true,
          props: { heading: "Need HVAC service?", supportingText: "View available Services and request a time that works for you.", buttonLabel: "Book service" },
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
          props: { heading: "Contact {{business.name}}", supportingText: "Get in touch with our team or book an HVAC Service online.", alignment: "left" },
        },
        { key: "details", label: "Contact details", type: "contact_details", variant: "page", visible: true, props: {} },
        { key: "hours", label: "Business hours", type: "business_hours", variant: "page", visible: true, props: {} },
        {
          key: "form",
          label: "Contact form",
          type: "contact_form",
          variant: "default",
          visible: true,
          props: { heading: "Send us a message", supportingText: "Share your question and your contact details, and the business can follow up with you." },
        },
        {
          key: "bookingCta",
          label: "Booking CTA",
          type: "call_to_action",
          variant: "default",
          visible: true,
          props: {
            heading: "Ready to schedule HVAC service?",
            supportingText: "Choose a Service and request or book a time using the available booking options.",
            buttonLabel: "Book service",
          },
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
          props: {
            heading: "Book HVAC service",
            supportingText: "Choose a Service and follow the available booking options to request or schedule your visit.",
            alignment: "left",
          },
        },
        { key: "experience", label: "Booking experience", type: "service_list", variant: "booking", visible: true, props: {} },
        {
          key: "alternative",
          label: "Contact alternative",
          type: "contact_details",
          variant: "callout",
          visible: true,
          props: { heading: "Prefer to contact us first?", supportingText: "You can contact {{business.name}} if you have questions before booking." },
        },
      ],
    },
  ],
};
