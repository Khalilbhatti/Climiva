/**
 * The Website module's own content: page text, section visibility, which Services are shown and in what order,
 * the publication state and the web addresses.
 *
 * It owns nothing else. Business name, phone, email, address and hours are read from the Business fixture
 * (data/fixtures), and every Service's name, description, price, duration and booking method is read from the
 * Services catalog (data/services); a "connected" section stores no text of its own. So an edit here can change
 * how the website presents a Service (hide it, move it) but never what the Service is.
 *
 * The site has exactly five pages: Home, Services, About, Contact and Booking. There is no page builder:
 * each page is a fixed list of sections whose text fields are listed in PAGE_SCHEMA.
 *
 * Sources: design-reference/stitch/ website_* screens. Conflicts are listed in docs/stitch-screen-map.md §10.
 *
 * Fixtures are read-only. Demo edits live in components/website/WebsiteProvider and reset on reload;
 * nothing is deployed anywhere.
 */
import { getPublicActiveServices, type Service } from "./services";

/* ───────────────────────── pages and sections ───────────────────────── */

export type PageId = "home" | "services" | "about" | "contact" | "booking";

export const WEBSITE_PAGES: readonly { id: PageId; title: string; path: string }[] = [
  { id: "home", title: "Home", path: "/" },
  { id: "services", title: "Services", path: "/services" },
  { id: "about", title: "About", path: "/about" },
  { id: "contact", title: "Contact", path: "/contact" },
  { id: "booking", title: "Booking", path: "/booking" },
];

export const getWebsitePage = (id: string) => WEBSITE_PAGES.find((page) => page.id === id);

export type FieldKind = "text" | "textarea" | "align";
export type FieldDef = { key: string; label: string; kind: FieldKind; max: number; default: string };

/** What a connected section reads from elsewhere in Climvia. */
export type ConnectedSource = "services" | "business-info" | "business-hours" | "booking";

export type SectionDef = {
  id: string;
  label: string;
  summary: string;
  connected?: ConnectedSource;
  fields: readonly FieldDef[];
};

const align = (): FieldDef => ({ key: "alignment", label: "Text alignment", kind: "align", max: 0, default: "left" });
const text = (key: string, label: string, def: string, max = 80): FieldDef => ({ key, label, kind: "text", max, default: def });
const area = (key: string, label: string, def: string, max = 240): FieldDef => ({ key, label, kind: "textarea", max, default: def });

export const PAGE_SCHEMA: Record<PageId, readonly SectionDef[]> = {
  home: [
    {
      id: "hero",
      label: "Hero",
      summary: "Headline, supporting text and buttons",
      fields: [
        text("headline", "Headline", "Heating & cooling service when you need it.", 80),
        area("supportingText", "Supporting text", "Book HVAC maintenance, diagnostics, and repair services with Apex Climate Heating & Air."),
        text("primaryCta", "Primary button label", "Book service", 24),
        text("secondaryCta", "Secondary button label", "View services", 24),
        align(),
      ],
    },
    {
      id: "services",
      label: "Services",
      summary: "Service cards from your catalog",
      connected: "services",
      fields: [
        text("heading", "Heading", "Our HVAC Services", 60),
        area("supportingText", "Supporting text", "Choose a service to view details and booking options.", 160),
      ],
    },
    {
      id: "why",
      label: "Why choose us",
      summary: "Three short reasons",
      fields: [
        text("heading", "Heading", "Why customers choose Apex Climate", 60),
        text("item1Title", "First reason: title", "Clear service options", 40),
        area("item1Text", "First reason: description", "See each service with its price and booking option before you book.", 120),
        text("item2Title", "Second reason: title", "Convenient online booking", 40),
        area("item2Text", "Second reason: description", "Book or request a time online in a few steps, from any device.", 120),
        text("item3Title", "Third reason: title", "Local customer support", 40),
        area("item3Text", "Third reason: description", "Heating and cooling specialists serving Austin, TX.", 120),
      ],
    },
    { id: "hours", label: "Business hours", summary: "From your business hours", connected: "business-hours", fields: [] },
    { id: "contact", label: "Contact", summary: "From your business information", connected: "business-info", fields: [] },
    {
      id: "bookingCta",
      label: "Booking CTA",
      summary: "Closing call to action",
      fields: [
        text("heading", "Heading", "Ready to schedule service?", 60),
        area("supportingText", "Supporting text", "Select an inspection, heating repair, or seasonal cooling tune-up online in a few minutes.", 160),
        text("buttonLabel", "Button label", "Book service", 24),
      ],
    },
  ],
  services: [
    {
      id: "intro",
      label: "Page intro",
      summary: "Heading and introduction",
      fields: [
        text("heading", "Heading", "HVAC Services", 80),
        area("supportingText", "Supporting text", "Explore maintenance, diagnostics, repair, and installation Services available from Apex Climate Heating & Air."),
        align(),
      ],
    },
    { id: "catalog", label: "Service catalog", summary: "Your services, in your order", connected: "services", fields: [] },
    {
      id: "bookingCta",
      label: "Booking CTA",
      summary: "Closing call to action",
      fields: [
        text("heading", "Heading", "Need HVAC service?", 60),
        area("supportingText", "Supporting text", "Choose a service and request a time that works for you.", 160),
        text("buttonLabel", "Button label", "Book service", 24),
      ],
    },
  ],
  about: [
    {
      id: "intro",
      label: "Page intro",
      summary: "Header and lead text",
      fields: [
        text("heading", "Main heading", "About Apex Climate Heating & Air", 80),
        area("supportingText", "Supporting text", "Learn more about our approach to HVAC service and the customers we serve."),
        align(),
      ],
    },
    {
      id: "business",
      label: "Our business",
      summary: "A short description",
      fields: [
        text("heading", "Heading", "Our business", 60),
        area("body", "Description", "Apex Climate Heating & Air provides HVAC maintenance, diagnostics, repair, and installation services in Austin, TX.", 400),
      ],
    },
    {
      id: "values",
      label: "What matters to us",
      summary: "Three standards",
      fields: [
        text("heading", "Heading", "What matters to us", 60),
        area("supportingText", "Supporting text", "Core standards applied across every scheduled appointment.", 160),
        text("item1Title", "First standard: title", "Clear communication", 40),
        area("item1Text", "First standard: description", "Explain service options and next steps clearly.", 120),
        text("item2Title", "Second standard: title", "Practical scheduling", 40),
        area("item2Text", "Second standard: description", "Make it easy for customers to request or book service.", 120),
        text("item3Title", "Third standard: title", "Organized service records", 40),
        area("item3Text", "Third standard: description", "Keep property and service information connected throughout the customer experience.", 120),
      ],
    },
    { id: "details", label: "Business details", summary: "From your business information", connected: "business-info", fields: [] },
    {
      id: "bookingCta",
      label: "Booking CTA",
      summary: "Closing call to action",
      fields: [
        text("heading", "Heading", "Need HVAC service?", 60),
        area("supportingText", "Supporting text", "View available Services and request a time that works for you.", 160),
        text("buttonLabel", "Button label", "Book service", 24),
      ],
    },
  ],
  contact: [
    {
      id: "intro",
      label: "Page intro",
      summary: "Heading and introduction",
      fields: [
        text("heading", "Heading", "Contact Apex Climate Heating & Air", 80),
        area("supportingText", "Supporting text", "Get in touch with our team or book an HVAC Service online."),
        align(),
      ],
    },
    { id: "details", label: "Contact details", summary: "From your business information", connected: "business-info", fields: [] },
    { id: "hours", label: "Business hours", summary: "From your business hours", connected: "business-hours", fields: [] },
    {
      id: "form",
      label: "Contact form",
      summary: "Message form copy",
      fields: [
        text("heading", "Heading", "Send us a message", 60),
        area("supportingText", "Supporting text", "Share your question and your contact details, and the business can follow up with you.", 160),
      ],
    },
    {
      id: "bookingCta",
      label: "Booking CTA",
      summary: "Closing call to action",
      fields: [
        text("heading", "Heading", "Ready to schedule HVAC service?", 60),
        area("supportingText", "Supporting text", "Choose a Service and request or book a time using the available booking options.", 160),
        text("buttonLabel", "Button label", "Book service", 24),
      ],
    },
  ],
  booking: [
    {
      id: "intro",
      label: "Page intro",
      summary: "Headline and instruction copy",
      fields: [
        text("heading", "Heading", "Book HVAC service", 80),
        area("supportingText", "Supporting text", "Choose a Service and follow the available booking options to request or schedule your visit."),
        align(),
      ],
    },
    { id: "experience", label: "Booking experience", summary: "Service grid with booking options", connected: "booking", fields: [] },
    {
      id: "alternative",
      label: "Contact alternative",
      summary: "Direct phone and email",
      fields: [
        text("heading", "Heading", "Prefer to contact us first?", 60),
        area("supportingText", "Supporting text", "You can contact Apex Climate Heating & Air if you have questions before booking.", 160),
      ],
    },
  ],
};

/* ───────────────────────── content ───────────────────────── */

export type SectionContent = { visible: boolean; values: Record<string, string> };
export type PageContent = Record<string, SectionContent>;
/** Which Services the site shows, and in what order. The Services themselves are never copied. */
export type ServiceDisplay = { order: readonly string[]; hidden: readonly string[] };
export type SiteContent = { pages: Record<PageId, PageContent>; services: ServiceDisplay };

export function defaultPageContent(page: PageId): PageContent {
  return Object.fromEntries(
    PAGE_SCHEMA[page].map((section) => [
      section.id,
      { visible: true, values: Object.fromEntries(section.fields.map((field) => [field.key, field.default])) },
    ]),
  );
}

export function defaultSiteContent(services: readonly Service[]): SiteContent {
  return {
    pages: Object.fromEntries(WEBSITE_PAGES.map((page) => [page.id, defaultPageContent(page.id)])) as Record<PageId, PageContent>,
    services: { order: getPublicActiveServices(services).map((service) => service.id), hidden: [] },
  };
}

/** The services the site shows: public and active in the business's catalog, minus the hidden ones, in site order. */
export function getShownServices(display: ServiceDisplay, services: readonly Service[]): Service[] {
  const catalog = getPublicActiveServices(services);
  const rank = (id: string) => {
    const index = display.order.indexOf(id);
    return index === -1 ? display.order.length : index;
  };
  return catalog
    .filter((service) => !display.hidden.includes(service.id))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.displayOrder - b.displayOrder);
}

/* ───────────────────────── publication and domains ───────────────────────── */

export const CLIMVIA_DOMAIN = "apexclimate.climvia.com";
export const DEFAULT_CUSTOM_DOMAIN = "www.apexclimateair.com";

export type DomainState = {
  /** Connected custom domain, if any. */
  custom?: string;
  /** Which address is the main one. The Climvia address can't be removed. */
  primary: "climvia" | "custom";
};

export type WebsiteState = {
  /** Publishing is independent of domains: a site can be live on the Climvia address alone. */
  published: boolean;
  /** Saved edits, shown by Preview. */
  draft: SiteContent;
  /** What visitors see: the draft as it was when last published. */
  live: SiteContent;
  domain: DomainState;
};

export function initialWebsiteState(services: readonly Service[]): WebsiteState {
  const content = defaultSiteContent(services);
  return {
    published: true,
    draft: content,
    live: content,
    // Both addresses connected, the Climvia one primary: the approved "Domain connected" state.
    domain: { custom: DEFAULT_CUSTOM_DOMAIN, primary: "climvia" },
  };
}

export const getPrimaryDomain = (domain: DomainState) => (domain.primary === "custom" && domain.custom ? domain.custom : CLIMVIA_DOMAIN);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type PageStatus = "published" | "unpublished-changes" | "private";

/** Pages that list services also change when the shown services or their order change. */
const SHOWS_SERVICES: readonly PageId[] = ["home", "services", "booking"];

export function getPageStatus(state: WebsiteState, page: PageId): PageStatus {
  if (!state.published) return "private";
  const servicesSame = !SHOWS_SERVICES.includes(page) || same(state.draft.services, state.live.services);
  return servicesSame && same(state.draft.pages[page], state.live.pages[page]) ? "published" : "unpublished-changes";
}

export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  published: "Published",
  "unpublished-changes": "Saved · unpublished changes",
  private: "Private",
};

export const hasUnpublishedChanges = (state: WebsiteState) => !same(state.draft, state.live);
