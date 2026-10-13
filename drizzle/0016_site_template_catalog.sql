-- The application's website Templates, phase 17: three new rows beside the starter, and the starter's display name.
--
-- No schema changes: `site_templates` already holds everything a Template is. A Template row is APPLICATION-OWNED content, so it is written
-- here, by a migration, and never by a tenant (the runtime role can read an active row and nothing more). src/db/site-templates.ts is the one
-- list of them and e2e/website-templates.spec.ts fails if a migrated row and its definition differ. The statements are generated:
--
--     npx tsx scripts/db/template-sql.ts precision comfort airflow
--
-- Nothing here touches a business's website: an existing Site keeps its Draft, its Published version and its selected Template exactly as
-- they are. A business changes Template only by choosing one in the Website Builder (the Template Gallery).
--
-- The starter's name only changes in case ("Climvia starter" -> "Climvia Starter"); its definition is not touched.
UPDATE site_templates SET name = 'Climvia Starter' WHERE key = 'climvia-starter';
--> statement-breakpoint
INSERT INTO site_templates (key, name, category, description, schema_version, definition, is_active)
VALUES ('precision', 'Precision', 'hvac', 'A structured, confident layout with a contact panel, a ruled service grid and clear booking buttons.', 1, $template${
  "schema": 1,
  "theme": {
    "schema": 1,
    "accent": "#1E40AF",
    "radius": "small",
    "density": "compact",
    "headingFont": "inter",
    "bodyFont": "inter",
    "look": "precision"
  },
  "settings": {
    "serviceDisplay": {
      "order": [],
      "hidden": []
    }
  },
  "pages": [
    {
      "key": "home",
      "title": "Home",
      "slug": "",
      "type": "home",
      "visible": true,
      "sections": [
        {
          "key": "hero",
          "label": "Opening",
          "type": "hero",
          "variant": "split",
          "visible": true,
          "props": {
            "headline": "Clear, scheduled heating and cooling service.",
            "supportingText": "See what {{business.name}} offers, choose a service and book a visit online.",
            "primaryCta": "Book service",
            "secondaryCta": "View services"
          }
        },
        {
          "key": "expect",
          "label": "What to expect",
          "type": "feature_list",
          "variant": "strip",
          "visible": true,
          "props": {
            "heading": "What to expect",
            "item1Title": "Clear service options",
            "item1Text": "See each service with its price and booking option before you book.",
            "item2Title": "Online scheduling",
            "item2Text": "Book or request a time online in a few steps, from any device.",
            "item3Title": "Local support",
            "item3Text": "Heating and cooling service in {{business.location}}."
          }
        },
        {
          "key": "services",
          "label": "Services",
          "type": "service_list",
          "variant": "grid",
          "visible": true,
          "props": {
            "heading": "Services",
            "supportingText": "Choose a service to see its price, duration and how to book it."
          }
        },
        {
          "key": "details",
          "label": "Contact and hours",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking band",
          "type": "call_to_action",
          "variant": "band",
          "visible": true,
          "props": {
            "heading": "Ready to schedule service?",
            "supportingText": "Choose a service and request or book a time.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "services",
      "title": "Services",
      "slug": "services",
      "type": "services",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "HVAC services",
            "supportingText": "Maintenance, diagnostics, repair and installation from {{business.name}}. Compare services and book the one you need.",
            "alignment": "left"
          }
        },
        {
          "key": "catalog",
          "label": "Service grid",
          "type": "service_list",
          "variant": "grid-catalog",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking band",
          "type": "call_to_action",
          "variant": "band",
          "visible": true,
          "props": {
            "heading": "Questions before you book?",
            "supportingText": "Contact {{business.name}} and ask before you choose a service.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "about",
      "title": "About",
      "slug": "about",
      "type": "content",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "About {{business.name}}",
            "supportingText": "How we work and what you can expect from us.",
            "alignment": "left"
          }
        },
        {
          "key": "approach",
          "label": "Our approach",
          "type": "rich_text",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Our approach",
            "body": "{{business.name}} provides HVAC maintenance, diagnostics, repair and installation services in {{business.location}}. Tell us what you need and we will point you to the right service."
          }
        },
        {
          "key": "standards",
          "label": "Our standards",
          "type": "feature_list",
          "variant": "strip",
          "visible": true,
          "props": {
            "heading": "Our standards",
            "item1Title": "Clear communication",
            "item1Text": "Explain service options and next steps clearly.",
            "item2Title": "Practical scheduling",
            "item2Text": "Make it easy to request or book service.",
            "item3Title": "Organized records",
            "item3Text": "Keep service information connected from booking to visit."
          }
        },
        {
          "key": "details",
          "label": "Contact and hours",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking band",
          "type": "call_to_action",
          "variant": "band",
          "visible": true,
          "props": {
            "heading": "Need HVAC service?",
            "supportingText": "View the available services and book a time that works for you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "contact",
      "title": "Contact",
      "slug": "contact",
      "type": "contact",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Contact {{business.name}}",
            "supportingText": "Call, write or book a service online.",
            "alignment": "left"
          }
        },
        {
          "key": "details",
          "label": "Contact and hours",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        },
        {
          "key": "form",
          "label": "Contact form",
          "type": "contact_form",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Send us a message",
            "supportingText": "Tell us what you need. You can also call or email using the details above."
          }
        },
        {
          "key": "bookingCta",
          "label": "Booking band",
          "type": "call_to_action",
          "variant": "band",
          "visible": true,
          "props": {
            "heading": "Ready to schedule HVAC service?",
            "supportingText": "Choose a service and request or book a time.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "booking",
      "title": "Booking",
      "slug": "booking",
      "type": "booking",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Book HVAC service",
            "supportingText": "Choose a service and follow the booking steps to request or schedule your visit.",
            "alignment": "left"
          }
        },
        {
          "key": "experience",
          "label": "Booking options",
          "type": "service_list",
          "variant": "booking",
          "visible": true,
          "props": {}
        },
        {
          "key": "details",
          "label": "Contact and hours",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        }
      ]
    }
  ]
}$template$::jsonb, true)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO site_templates (key, name, category, description, schema_version, definition, is_active)
VALUES ('comfort', 'Comfort', 'hvac', 'A warm, welcoming layout for home service, with friendly cards, a reassurance panel and a clear booking path.', 1, $template${
  "schema": 1,
  "theme": {
    "schema": 1,
    "accent": "#9A3412",
    "radius": "large",
    "density": "comfortable",
    "headingFont": "serif",
    "bodyFont": "inter",
    "look": "comfort"
  },
  "settings": {
    "serviceDisplay": {
      "order": [],
      "hidden": []
    }
  },
  "pages": [
    {
      "key": "home",
      "title": "Home",
      "slug": "",
      "type": "home",
      "visible": true,
      "sections": [
        {
          "key": "hero",
          "label": "Welcome",
          "type": "hero",
          "variant": "welcome",
          "visible": true,
          "props": {
            "headline": "Heating and cooling that keeps your home comfortable.",
            "supportingText": "Book maintenance, repairs and seasonal tune-ups with {{business.name}}, at a time that suits your household.",
            "primaryCta": "Book service",
            "secondaryCta": "View services"
          }
        },
        {
          "key": "expect",
          "label": "What to expect",
          "type": "feature_list",
          "variant": "reassure",
          "visible": true,
          "props": {
            "heading": "What to expect when you book",
            "supportingText": "Booking with {{business.name}} is simple and clear.",
            "item1Title": "Choose your service",
            "item1Text": "See each service and its price before you book.",
            "item2Title": "Pick a time",
            "item2Text": "Select a time that fits around your day.",
            "item3Title": "Get help close to home",
            "item3Text": "A local team serving {{business.location}}."
          }
        },
        {
          "key": "services",
          "label": "Services",
          "type": "service_list",
          "variant": "friendly",
          "visible": true,
          "props": {
            "heading": "Our services",
            "supportingText": "Heating, cooling and seasonal care for your home. Choose a service to see what it includes."
          }
        },
        {
          "key": "maintenance",
          "label": "Seasonal maintenance",
          "type": "rich_text",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Seasonal maintenance",
            "body": "Ask about a maintenance visit before the weather turns. Choose it from our services and book it online."
          }
        },
        {
          "key": "contact",
          "label": "We are here to help",
          "type": "contact_details",
          "variant": "callout",
          "visible": true,
          "props": {
            "heading": "We are here to help",
            "supportingText": "Call or email {{business.name}} with any question about your home comfort."
          }
        },
        {
          "key": "bookingCta",
          "label": "Booking panel",
          "type": "call_to_action",
          "variant": "panel",
          "visible": true,
          "props": {
            "heading": "Ready to schedule service?",
            "supportingText": "Choose a service and a time that works for your household.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "services",
      "title": "Services",
      "slug": "services",
      "type": "services",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Our services",
            "supportingText": "Heating, cooling and maintenance for your home from {{business.name}}.",
            "alignment": "center"
          }
        },
        {
          "key": "catalog",
          "label": "Service cards",
          "type": "service_list",
          "variant": "friendly-catalog",
          "visible": true,
          "props": {}
        },
        {
          "key": "help",
          "label": "Not sure what you need",
          "type": "rich_text",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Not sure what you need?",
            "body": "Describe the problem when you book, or choose a maintenance visit to start. You can also call or email us first."
          }
        },
        {
          "key": "bookingCta",
          "label": "Booking panel",
          "type": "call_to_action",
          "variant": "panel",
          "visible": true,
          "props": {
            "heading": "Ready to book?",
            "supportingText": "Choose a service and request a time that suits you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "about",
      "title": "About",
      "slug": "about",
      "type": "content",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "About {{business.name}}",
            "supportingText": "Who we are and how we work.",
            "alignment": "center"
          }
        },
        {
          "key": "approach",
          "label": "Our approach",
          "type": "rich_text",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Our approach",
            "body": "{{business.name}} provides heating, cooling and maintenance services in {{business.location}}. We want booking and service to be clear and easy for every household."
          }
        },
        {
          "key": "values",
          "label": "What matters to us",
          "type": "feature_list",
          "variant": "reassure",
          "visible": true,
          "props": {
            "heading": "What matters to us",
            "supportingText": "Standards we apply to every visit.",
            "item1Title": "Clear communication",
            "item1Text": "Explain options and next steps in plain words.",
            "item2Title": "Convenient scheduling",
            "item2Text": "Make it easy to request or book a visit.",
            "item3Title": "Careful visits",
            "item3Text": "Plan each visit around your household."
          }
        },
        {
          "key": "contact",
          "label": "Talk to us",
          "type": "contact_details",
          "variant": "callout",
          "visible": true,
          "props": {
            "heading": "Talk to us",
            "supportingText": "Call or email {{business.name}} to ask about our services."
          }
        },
        {
          "key": "bookingCta",
          "label": "Booking panel",
          "type": "call_to_action",
          "variant": "panel",
          "visible": true,
          "props": {
            "heading": "Need HVAC service?",
            "supportingText": "View the available services and book a time that works for you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "contact",
      "title": "Contact",
      "slug": "contact",
      "type": "contact",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Contact {{business.name}}",
            "supportingText": "We would be glad to hear from you.",
            "alignment": "center"
          }
        },
        {
          "key": "talk",
          "label": "Talk to us",
          "type": "contact_details",
          "variant": "callout",
          "visible": true,
          "props": {
            "heading": "Talk to us",
            "supportingText": "Call or email {{business.name}}, or book a service online."
          }
        },
        {
          "key": "form",
          "label": "Contact form",
          "type": "contact_form",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Send us a message",
            "supportingText": "Tell us what you need. You can also call or email using the details above."
          }
        },
        {
          "key": "hours",
          "label": "Business hours",
          "type": "business_hours",
          "variant": "page",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Booking panel",
          "type": "call_to_action",
          "variant": "panel",
          "visible": true,
          "props": {
            "heading": "Ready to schedule HVAC service?",
            "supportingText": "Choose a service and request or book a time.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "booking",
      "title": "Booking",
      "slug": "booking",
      "type": "booking",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Book your visit",
            "supportingText": "Choose a service and follow the booking steps to request or schedule your visit.",
            "alignment": "center"
          }
        },
        {
          "key": "experience",
          "label": "Booking options",
          "type": "service_list",
          "variant": "booking",
          "visible": true,
          "props": {}
        },
        {
          "key": "before",
          "label": "Before you book",
          "type": "feature_list",
          "variant": "reassure",
          "visible": true,
          "props": {
            "heading": "Before you book",
            "supportingText": "A few things to know.",
            "item1Title": "Choose your service",
            "item1Text": "Each service shows its price and how it is booked.",
            "item2Title": "Pick a time",
            "item2Text": "Request or select a time that suits your household.",
            "item3Title": "Ask us anything",
            "item3Text": "Call or email {{business.name}} if you have a question first."
          }
        }
      ]
    }
  ]
}$template$::jsonb, true)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

INSERT INTO site_templates (key, name, category, description, schema_version, definition, is_active)
VALUES ('airflow', 'Airflow', 'hvac', 'An editorial, spacious layout with large type, index-style services and very little chrome.', 1, $template${
  "schema": 1,
  "theme": {
    "schema": 1,
    "accent": "#27272A",
    "radius": "medium",
    "density": "comfortable",
    "headingFont": "inter",
    "bodyFont": "inter",
    "look": "airflow"
  },
  "settings": {
    "serviceDisplay": {
      "order": [],
      "hidden": []
    }
  },
  "pages": [
    {
      "key": "home",
      "title": "Home",
      "slug": "",
      "type": "home",
      "visible": true,
      "sections": [
        {
          "key": "hero",
          "label": "Opening",
          "type": "hero",
          "variant": "editorial",
          "visible": true,
          "props": {
            "headline": "Heating and cooling service you can count on.",
            "supportingText": "Book maintenance, repairs and installations with {{business.name}}, online and at a time that suits you.",
            "primaryCta": "Book service",
            "secondaryCta": "View services"
          }
        },
        {
          "key": "services",
          "label": "Services",
          "type": "service_list",
          "variant": "rows",
          "visible": true,
          "props": {
            "heading": "Services",
            "supportingText": "Choose a service to see what it includes."
          }
        },
        {
          "key": "how",
          "label": "How it works",
          "type": "feature_list",
          "variant": "numbered",
          "visible": true,
          "props": {
            "heading": "How it works",
            "supportingText": "Three steps from first look to booked visit.",
            "item1Title": "Choose a service",
            "item1Text": "Browse the services the business offers and their prices.",
            "item2Title": "Pick a time",
            "item2Text": "Request or book a visit online in a few steps.",
            "item3Title": "Get service",
            "item3Text": "The business confirms your visit and arrives at the scheduled time."
          }
        },
        {
          "key": "details",
          "label": "Contact and hours",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Closing statement",
          "type": "call_to_action",
          "variant": "editorial",
          "visible": true,
          "props": {
            "heading": "Ready when you are.",
            "supportingText": "Choose a service and a time that suits you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "services",
      "title": "Services",
      "slug": "services",
      "type": "services",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Services",
            "supportingText": "Maintenance, diagnostics, repair and installation from {{business.name}}.",
            "alignment": "left"
          }
        },
        {
          "key": "catalog",
          "label": "Service rows",
          "type": "service_list",
          "variant": "rows-catalog",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Closing statement",
          "type": "call_to_action",
          "variant": "editorial",
          "visible": true,
          "props": {
            "heading": "Not sure which service?",
            "supportingText": "Contact {{business.name}} before you book.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "about",
      "title": "About",
      "slug": "about",
      "type": "content",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "About {{business.name}}",
            "supportingText": "How we work, in a few words.",
            "alignment": "left"
          }
        },
        {
          "key": "approach",
          "label": "Our approach",
          "type": "rich_text",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Our approach",
            "body": "{{business.name}} provides HVAC maintenance, diagnostics, repair and installation services in {{business.location}}. Booking and service should be clear from the first click to the last visit."
          }
        },
        {
          "key": "values",
          "label": "What matters to us",
          "type": "feature_list",
          "variant": "numbered",
          "visible": true,
          "props": {
            "heading": "What matters to us",
            "supportingText": "Three things we keep in mind on every visit.",
            "item1Title": "Clear communication",
            "item1Text": "Explain options and next steps clearly.",
            "item2Title": "Practical scheduling",
            "item2Text": "Make it easy to request or book a visit.",
            "item3Title": "Organized records",
            "item3Text": "Keep service information connected from booking to visit."
          }
        },
        {
          "key": "details",
          "label": "Contact and hours",
          "type": "business_details",
          "variant": "default",
          "visible": true,
          "props": {}
        },
        {
          "key": "bookingCta",
          "label": "Closing statement",
          "type": "call_to_action",
          "variant": "editorial",
          "visible": true,
          "props": {
            "heading": "Need HVAC service?",
            "supportingText": "View the available services and book a time that works for you.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "contact",
      "title": "Contact",
      "slug": "contact",
      "type": "contact",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Contact {{business.name}}",
            "supportingText": "Hours, phone and a way to write to us.",
            "alignment": "left"
          }
        },
        {
          "key": "hours",
          "label": "Business hours",
          "type": "business_hours",
          "variant": "page",
          "visible": true,
          "props": {}
        },
        {
          "key": "details",
          "label": "Contact details",
          "type": "contact_details",
          "variant": "page",
          "visible": true,
          "props": {}
        },
        {
          "key": "form",
          "label": "Contact form",
          "type": "contact_form",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Send us a message",
            "supportingText": "Tell us what you need. You can also call or email using the details above."
          }
        },
        {
          "key": "bookingCta",
          "label": "Closing statement",
          "type": "call_to_action",
          "variant": "editorial",
          "visible": true,
          "props": {
            "heading": "Ready to schedule?",
            "supportingText": "Choose a service and request or book a time.",
            "buttonLabel": "Book service"
          }
        }
      ]
    },
    {
      "key": "booking",
      "title": "Booking",
      "slug": "booking",
      "type": "booking",
      "visible": true,
      "sections": [
        {
          "key": "intro",
          "label": "Page intro",
          "type": "page_intro",
          "variant": "default",
          "visible": true,
          "props": {
            "heading": "Book service",
            "supportingText": "Choose a service and follow the booking steps to request or schedule your visit.",
            "alignment": "left"
          }
        },
        {
          "key": "experience",
          "label": "Booking options",
          "type": "service_list",
          "variant": "booking",
          "visible": true,
          "props": {}
        },
        {
          "key": "next",
          "label": "What happens next",
          "type": "feature_list",
          "variant": "numbered",
          "visible": true,
          "props": {
            "heading": "What happens next",
            "supportingText": "Three steps after you choose a service.",
            "item1Title": "Choose a service",
            "item1Text": "Pick the service you need from the list above.",
            "item2Title": "Pick a time",
            "item2Text": "Request or select a time in the booking steps.",
            "item3Title": "Get confirmation",
            "item3Text": "The business confirms your visit with you."
          }
        }
      ]
    }
  ]
}$template$::jsonb, true)
ON CONFLICT (key) DO NOTHING;
