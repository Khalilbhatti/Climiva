/**
 * The section registry: every kind of section a Site page may hold, and nothing else.
 *
 *     section type  ->  allowed variants  ->  the text fields each variant has (with their limits)  ->  how it connects to the business
 *
 * A section is DATA (a row in `site_sections`: type, variant, props). The component that draws it lives in application code
 * (components/website/SiteRenderer), keyed by the same type and variant. PostgreSQL never holds executable code, markup or styles:
 * `props` is a flat map of PLAIN-TEXT strings whose keys, lengths and characters are validated here, on the server, before anything is
 * stored (`validateProps`), and again when a stored row is read for rendering (`readProps`), so an unknown type, an unknown variant or
 * an unknown key fails safely instead of being rendered.
 *
 * What a section does NOT hold: the business's name, phone, email, address or hours (they are read from the organization when the page is
 * drawn), and a Service's name, price or duration (a service section is bound to the business's public Services). Authored copy may
 * contain the two text tokens in TOKENS, which the renderer replaces with the organization's current name and location.
 *
 * Pure: no database, no framework. Shared by the editor, the server actions, the renderer, the seed and the tests.
 */

export const SECTION_TYPES = [
  "hero",
  "page_intro",
  "service_list",
  "feature_list",
  "rich_text",
  "business_hours",
  "contact_details",
  "business_details",
  "contact_form",
  "call_to_action",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type FieldKind = "text" | "textarea" | "align";
export type FieldDef = { key: string; label: string; kind: FieldKind; max: number };

/** What a connected section reads from elsewhere in Climvia (never copied into the section). */
export type ConnectedSource = "services" | "business-info" | "business-hours" | "booking";

export type VariantDef = {
  id: string;
  /** The text fields this variant has, when they differ from the type's. A variant with `fields: []` carries no text of its own. */
  fields?: readonly FieldDef[];
  /** Replaces a field's label in the editor for this variant (the same field is a "reason" in one place and a "standard" in another). */
  fieldLabels?: Readonly<Record<string, string>>;
  connected?: ConnectedSource;
};

export type SectionTypeDef = {
  type: SectionType;
  /** What the section is called in a list of section types. A section row has its own label for the page it is on. */
  label: string;
  /** One line under the section's name in the editor's list. */
  summary: string;
  variants: readonly VariantDef[];
  /** The fields every variant has unless it names its own. */
  fields: readonly FieldDef[];
};

const align: FieldDef = { key: "alignment", label: "Text alignment", kind: "align", max: 0 };
const text = (key: string, label: string, max = 80): FieldDef => ({ key, label, kind: "text", max });
const area = (key: string, label: string, max = 240): FieldDef => ({ key, label, kind: "textarea", max });

const FEATURE_ITEMS: readonly FieldDef[] = [
  text("item1Title", "Item 1: title", 40),
  area("item1Text", "Item 1: description", 120),
  text("item2Title", "Item 2: title", 40),
  area("item2Text", "Item 2: description", 120),
  text("item3Title", "Item 3: title", 40),
  area("item3Text", "Item 3: description", 120),
];

const featureLabels = (noun: string): Record<string, string> => {
  const labels: Record<string, string> = {};
  (["First", "Second", "Third"] as const).forEach((ordinal, index) => {
    const n = index + 1;
    labels[`item${n}Title`] = `${ordinal} ${noun}: title`;
    labels[`item${n}Text`] = `${ordinal} ${noun}: description`;
  });
  return labels;
};

const HEADING_AND_TEXT: readonly FieldDef[] = [text("heading", "Heading", 60), area("supportingText", "Supporting text", 160)];

/** A hero whose layout is fixed by its style, so it has no alignment choice. */
const HERO_COPY: readonly FieldDef[] = [
  text("headline", "Headline", 80),
  area("supportingText", "Supporting text", 240),
  text("primaryCta", "Primary button label", 24),
  text("secondaryCta", "Secondary button label", 24),
];

export const SECTION_REGISTRY: Readonly<Record<SectionType, SectionTypeDef>> = {
  hero: {
    type: "hero",
    label: "Hero",
    summary: "Headline, supporting text and buttons",
    // The first opens on a brand-colour banner; the others are the Templates' own openings: a headline beside the business's phone and
    // hours, a warm welcome with a way to call, and a large editorial headline.
    variants: [
      { id: "default" },
      { id: "split", connected: "business-info", fields: HERO_COPY },
      { id: "welcome", connected: "business-info", fields: HERO_COPY },
      { id: "editorial", fields: HERO_COPY },
    ],
    fields: [
      text("headline", "Headline", 80),
      area("supportingText", "Supporting text", 240),
      text("primaryCta", "Primary button label", 24),
      text("secondaryCta", "Secondary button label", 24),
      align,
    ],
  },
  page_intro: {
    type: "page_intro",
    label: "Page intro",
    summary: "Heading and introduction",
    variants: [{ id: "default" }],
    fields: [text("heading", "Heading", 80), area("supportingText", "Supporting text", 240), align],
  },
  service_list: {
    type: "service_list",
    label: "Services",
    summary: "Services from your catalog",
    // Which Services appear, and in what order, is set once for the whole site (the version's settings), not copied into a section.
    // Only the "cards" variant has a heading of its own; the catalog and the booking grid sit under the page's intro.
    // Each presentation comes twice: with a heading of its own for a shortlist on the home page, and without for a full list that sits
    // under a page's introduction (so the page keeps one heading outline).
    variants: [
      { id: "cards", connected: "services", fields: HEADING_AND_TEXT },
      { id: "catalog", connected: "services", fields: [] },
      { id: "booking", connected: "booking", fields: [] },
      { id: "grid", connected: "services", fields: HEADING_AND_TEXT },
      { id: "grid-catalog", connected: "services", fields: [] },
      { id: "friendly", connected: "services", fields: HEADING_AND_TEXT },
      { id: "friendly-catalog", connected: "services", fields: [] },
      { id: "rows", connected: "services", fields: HEADING_AND_TEXT },
      { id: "rows-catalog", connected: "services", fields: [] },
    ],
    fields: [],
  },
  feature_list: {
    type: "feature_list",
    label: "Three points",
    summary: "A heading and three short points",
    variants: [
      { id: "icons", fieldLabels: featureLabels("reason"), fields: [text("heading", "Heading", 60), ...FEATURE_ITEMS] },
      { id: "plain", fieldLabels: featureLabels("standard"), fields: [text("heading", "Heading", 60), area("supportingText", "Supporting text", 160), ...FEATURE_ITEMS] },
      { id: "strip", fieldLabels: featureLabels("point"), fields: [text("heading", "Heading", 60), ...FEATURE_ITEMS] },
      { id: "numbered", fieldLabels: featureLabels("step"), fields: [text("heading", "Heading", 60), area("supportingText", "Supporting text", 160), ...FEATURE_ITEMS] },
      { id: "reassure", fieldLabels: featureLabels("reason"), fields: [text("heading", "Heading", 60), area("supportingText", "Supporting text", 160), ...FEATURE_ITEMS] },
    ],
    fields: [],
  },
  rich_text: {
    type: "rich_text",
    label: "Text block",
    summary: "A heading and a short description",
    variants: [{ id: "default" }],
    fields: [text("heading", "Heading", 60), area("body", "Description", 400)],
  },
  business_hours: {
    type: "business_hours",
    label: "Business hours",
    summary: "From your business hours",
    variants: [
      { id: "card", connected: "business-hours" },
      { id: "page", connected: "business-hours" },
    ],
    fields: [],
  },
  contact_details: {
    type: "contact_details",
    label: "Contact",
    summary: "From your business information",
    // Only the "callout" variant has copy of its own.
    variants: [
      { id: "card", connected: "business-info" },
      { id: "page", connected: "business-info" },
      { id: "callout", connected: "business-info", fields: HEADING_AND_TEXT },
    ],
    fields: [],
  },
  business_details: {
    type: "business_details",
    label: "Business details",
    summary: "From your business information",
    variants: [{ id: "default", connected: "business-info" }],
    fields: [],
  },
  contact_form: {
    type: "contact_form",
    label: "Contact form",
    summary: "Message form copy",
    variants: [{ id: "default" }],
    fields: HEADING_AND_TEXT,
  },
  call_to_action: {
    type: "call_to_action",
    label: "Call to action",
    summary: "Closing call to action",
    // The band and the panel also offer the business's phone number (read from Settings); the editorial one is a single large link.
    variants: [{ id: "default" }, { id: "band", connected: "business-info" }, { id: "panel", connected: "business-info" }, { id: "editorial" }],
    fields: [text("heading", "Heading", 60), area("supportingText", "Supporting text", 160), text("buttonLabel", "Button label", 24)],
  },
};

export const isSectionType = (value: unknown): value is SectionType => typeof value === "string" && (SECTION_TYPES as readonly string[]).includes(value);

export const variantDef = (type: SectionType, variant: string): VariantDef | undefined => SECTION_REGISTRY[type].variants.find((candidate) => candidate.id === variant);

/** The fields a section of this type and variant has: none for a variant that carries no text of its own. */
export function fieldsOf(type: SectionType, variant: string): readonly FieldDef[] {
  return variantDef(type, variant)?.fields ?? SECTION_REGISTRY[type].fields;
}

/** The label of a field in the editor, which a variant may reword. */
export const fieldLabel = (type: SectionType, variant: string, field: FieldDef): string => variantDef(type, variant)?.fieldLabels?.[field.key] ?? field.label;

export const connectedOf = (type: SectionType, variant: string): ConnectedSource | undefined => variantDef(type, variant)?.connected;

/* ───────────────────────── text tokens ───────────────────────── */

/**
 * The only dynamic text a section may contain: they are replaced when the page is drawn, from the organization's current record,
 * so a rename or a move is followed without republishing and no section holds a copy of the business's identity.
 */
export const TOKENS = ["{{business.name}}", "{{business.location}}"] as const;

export type TokenValues = { name: string; location: string };

export function fillTokens(value: string, business: TokenValues): string {
  return value.replaceAll("{{business.name}}", business.name).replaceAll("{{business.location}}", business.location);
}

/** "Austin, TX": the city and the state of the organization's address. */
export const locationOf = (address: { city: string; state: string }): string => [address.city, address.state].filter(Boolean).join(", ");

/* ───────────────────────── validation ───────────────────────── */

export type Props = Record<string, string>;
export type PropsResult = { ok: true; props: Props } | { ok: false; error: string; fields: Record<string, string> };

// Plain text only. No markup characters, no control characters, no script-looking schemes: a section's text is drawn as text and is
// never interpreted, and this keeps it that way for whatever draws it later (a Builder, an email, an export).
const MARKUP = /[<>]/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SCHEME = /\b(?:javascript|data|vbscript)\s*:/i;
const HANDLER = /\bon[a-z]+\s*=/i;
const UNKNOWN_TOKEN = /\{\{(?!business\.(?:name|location)\}\})/;

/** Why a text is not acceptable as section copy, or undefined when it is. */
export function textProblem(value: string): string | undefined {
  if (MARKUP.test(value)) return "Use plain text. The characters < and > are not allowed.";
  if (CONTROL.test(value)) return "That text contains characters that can't be shown.";
  if (SCHEME.test(value)) return "That text looks like a script or a link. Use plain words.";
  if (HANDLER.test(value)) return "That text looks like code. Use plain words.";
  if (UNKNOWN_TOKEN.test(value)) return "Only {{business.name}} and {{business.location}} can be used between double braces.";
  return undefined;
}

/**
 * Check a section's props against its type and variant: only the declared keys, each a string within its limit, plain text, every
 * field present (an alignment is "left" or "center"). Returns the props with the declared keys only, in the declared order.
 */
export function validateProps(type: unknown, variant: unknown, input: unknown): PropsResult {
  if (!isSectionType(type)) return { ok: false, error: "That kind of section is not available.", fields: {} };
  if (typeof variant !== "string" || !variantDef(type, variant)) return { ok: false, error: "That section style is not available.", fields: {} };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "The section's content was not understood.", fields: {} };
  const raw = input as Record<string, unknown>;
  const fields = fieldsOf(type, variant);
  const allowed = new Set(fields.map((field) => field.key));
  const extra = Object.keys(raw).filter((key) => !allowed.has(key));
  if (extra.length > 0) return { ok: false, error: "The section has content it cannot hold.", fields: Object.fromEntries(extra.map((key) => [key, "Not available for this section."])) };

  const props: Props = {};
  const problems: Record<string, string> = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (typeof value !== "string") {
      problems[field.key] = "This field can't be empty.";
      continue;
    }
    if (field.kind === "align") {
      if (value !== "left" && value !== "center") problems[field.key] = "Choose left or center.";
      else props[field.key] = value;
      continue;
    }
    if (value.trim() === "") problems[field.key] = "This field can't be empty.";
    else if (value.length > field.max) problems[field.key] = `Keep this to ${field.max} characters or fewer.`;
    else {
      const problem = textProblem(value);
      if (problem) problems[field.key] = problem;
      else props[field.key] = value;
    }
  }
  if (Object.keys(problems).length > 0) return { ok: false, error: "Check the highlighted fields.", fields: problems };
  return { ok: true, props };
}

/**
 * A stored section's props, for drawing. Anything that does not validate (a row written by something that skipped the checks) is
 * dropped to the declared keys that do: the page is still drawn, with whatever is safe, and never with a value that was refused.
 */
export function readProps(type: SectionType, variant: string, input: unknown): Props {
  const raw = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const props: Props = {};
  for (const field of fieldsOf(type, variant)) {
    const value = raw[field.key];
    if (typeof value !== "string") continue;
    if (field.kind === "align") {
      if (value === "left" || value === "center") props[field.key] = value;
    } else if (value.length <= field.max && textProblem(value) === undefined) props[field.key] = value;
  }
  return props;
}

export const SECTION_LABEL_MAX = 60;

/* ───────────────────────── builder metadata ───────────────────────── */

/**
 * What the Website Builder needs to know about a registered section that the renderer does not: the group it is offered under in the
 * Section library, a human name and a one-line description for each variant, and the plain text a NEW section starts with. It lives beside
 * the registry (not in the database and not in the components) so the library, the inspector, the server and the tests all read one
 * description, and so a section type added here is offered by the Builder without any other change.
 */
export const SECTION_CATEGORIES = [
  { id: "hero", label: "Hero" },
  { id: "content", label: "Content" },
  { id: "services", label: "Services" },
  { id: "booking", label: "Booking" },
  { id: "contact", label: "Contact" },
  { id: "action", label: "Calls to action" },
] as const;
export type SectionCategory = (typeof SECTION_CATEGORIES)[number]["id"];

type VariantMeta = { label: string; description: string; category: SectionCategory; defaults: Props };

const FEATURE_DEFAULTS = {
  item1Title: "First point",
  item1Text: "Say what makes this point matter to your customers.",
  item2Title: "Second point",
  item2Text: "Add a second reason to choose your business.",
  item3Title: "Third point",
  item3Text: "Finish with a third short, clear point.",
};

const VARIANT_META: Readonly<Record<SectionType, Readonly<Record<string, VariantMeta>>>> = {
  hero: {
    default: {
      label: "Hero",
      description: "A large opening banner with a headline, a short introduction and two buttons.",
      category: "hero",
      defaults: {
        headline: "A clear headline for your business",
        supportingText: "Tell visitors what {{business.name}} does and how to get started.",
        primaryCta: "Book service",
        secondaryCta: "View services",
        alignment: "left",
      },
    },
    split: {
      label: "Opening with contact panel",
      description: "A headline and two buttons beside a panel with your phone number and business hours, read from Settings.",
      category: "hero",
      defaults: {
        headline: "A clear headline for your business",
        supportingText: "Tell visitors what {{business.name}} does and how to get started.",
        primaryCta: "Book service",
        secondaryCta: "View services",
      },
    },
    welcome: {
      label: "Welcoming opening",
      description: "A warm, friendly opening with a large headline, a booking button and a way to call you.",
      category: "hero",
      defaults: {
        headline: "A clear headline for your business",
        supportingText: "Tell visitors what {{business.name}} does and how to get started.",
        primaryCta: "Book service",
        secondaryCta: "View services",
      },
    },
    editorial: {
      label: "Editorial opening",
      description: "A very large headline with plenty of white space and two simple links.",
      category: "hero",
      defaults: {
        headline: "A clear headline for your business",
        supportingText: "Tell visitors what {{business.name}} does and how to get started.",
        primaryCta: "Book service",
        secondaryCta: "View services",
      },
    },
  },
  page_intro: {
    default: {
      label: "Page heading",
      description: "The page's title with a short introduction.",
      category: "content",
      defaults: { heading: "Page heading", supportingText: "A short introduction to this page.", alignment: "left" },
    },
  },
  service_list: {
    cards: {
      label: "Service cards",
      description: "Your Services as cards under a heading. Prices and booking come from your Service catalog.",
      category: "services",
      defaults: { heading: "Our services", supportingText: "Choose a service to see its details and booking options." },
    },
    catalog: {
      label: "Service catalog",
      description: "Every Service you show, in full, for a Services page.",
      category: "services",
      defaults: {},
    },
    booking: {
      label: "Booking options",
      description: "Your Services as booking choices, so customers can pick one to book.",
      category: "booking",
      defaults: {},
    },
    grid: {
      label: "Service grid",
      description: "Your Services in a crisp, ruled grid under a heading, with price and duration in plain view.",
      category: "services",
      defaults: { heading: "Our services", supportingText: "Choose a service to see its price, duration and booking options." },
    },
    "grid-catalog": {
      label: "Service grid (full list)",
      description: "Every Service you show, in a ruled grid, for a Services page.",
      category: "services",
      defaults: {},
    },
    friendly: {
      label: "Friendly services",
      description: "Your Services as roomy, rounded cards with an icon, the full description and a booking button.",
      category: "services",
      defaults: { heading: "Our services", supportingText: "Choose a service to see what it includes and how to book it." },
    },
    "friendly-catalog": {
      label: "Friendly services (full list)",
      description: "Every Service you show, as roomy rounded cards, for a Services page.",
      category: "services",
      defaults: {},
    },
    rows: {
      label: "Service rows",
      description: "Your Services as large, quiet rows under a heading, like an index.",
      category: "services",
      defaults: { heading: "Services", supportingText: "Choose a service to see what it includes." },
    },
    "rows-catalog": {
      label: "Service rows (full list)",
      description: "Every Service you show, as large quiet rows, for a Services page.",
      category: "services",
      defaults: {},
    },
  },
  feature_list: {
    icons: {
      label: "Three points with icons",
      description: "A heading and three short reasons, each with an icon.",
      category: "content",
      defaults: { heading: "Why choose {{business.name}}", ...FEATURE_DEFAULTS },
    },
    plain: {
      label: "Three points",
      description: "A heading, an introduction and three short standards, without icons.",
      category: "content",
      defaults: { heading: "What you can expect", supportingText: "A few words on how {{business.name}} works.", ...FEATURE_DEFAULTS },
    },
    strip: {
      label: "Trust strip",
      description: "A heading above a compact band of three short points, each with a check mark.",
      category: "content",
      defaults: { heading: "What you can expect", ...FEATURE_DEFAULTS },
    },
    numbered: {
      label: "Numbered steps",
      description: "A heading, an introduction and three numbered steps, with no boxes around them.",
      category: "content",
      defaults: { heading: "How it works", supportingText: "A few words on how {{business.name}} works.", item1Title: "First step", item1Text: "Say what happens first.", item2Title: "Second step", item2Text: "Say what happens next.", item3Title: "Third step", item3Text: "Finish with what the customer gets." },
    },
    reassure: {
      label: "Reassurance panel",
      description: "A soft rounded panel with a heading, an introduction and three short reasons, each with a check mark.",
      category: "content",
      defaults: { heading: "What to expect", supportingText: "A few words on how {{business.name}} works.", ...FEATURE_DEFAULTS },
    },
  },
  rich_text: {
    default: {
      label: "Text block",
      description: "A heading with a short paragraph.",
      category: "content",
      defaults: { heading: "About this section", body: "Write a few plain sentences here." },
    },
  },
  business_hours: {
    card: { label: "Hours card", description: "Your business hours, read from Settings.", category: "contact", defaults: {} },
    page: { label: "Hours card (page level)", description: "Your business hours with a page-level heading, for a page about hours.", category: "contact", defaults: {} },
  },
  contact_details: {
    card: { label: "Contact card", description: "Your phone, email and address, read from Settings.", category: "contact", defaults: {} },
    page: { label: "Contact card (page level)", description: "Your contact details with a page-level heading.", category: "contact", defaults: {} },
    callout: {
      label: "Contact callout",
      description: "A heading and a sentence beside your contact details.",
      category: "contact",
      defaults: { heading: "Get in touch", supportingText: "Reach {{business.name}} by phone or email." },
    },
  },
  business_details: {
    default: { label: "Business details", description: "Your contact details and business hours side by side, read from Settings.", category: "contact", defaults: {} },
  },
  contact_form: {
    default: {
      label: "Contact form",
      description: "A message form. Messages are not delivered yet: the public site points visitors to your phone and email.",
      category: "contact",
      defaults: { heading: "Send us a message", supportingText: "Tell us what you need and how to reach you." },
    },
  },
  call_to_action: {
    default: {
      label: "Call to action",
      description: "A closing banner that leads visitors to book.",
      category: "action",
      defaults: { heading: "Ready to get started?", supportingText: "Pick a service and choose a time that suits you.", buttonLabel: "Book service" },
    },
    band: {
      label: "Closing band",
      description: "A ruled band with a heading, a booking button and your phone number, read from Settings.",
      category: "action",
      defaults: { heading: "Ready to get started?", supportingText: "Pick a service and choose a time that suits you.", buttonLabel: "Book service" },
    },
    panel: {
      label: "Closing panel",
      description: "A soft, centered panel with a heading, a booking button and your phone number, read from Settings.",
      category: "action",
      defaults: { heading: "Ready to get started?", supportingText: "Pick a service and choose a time that suits you.", buttonLabel: "Book service" },
    },
    editorial: {
      label: "Closing statement",
      description: "A large statement with one quiet booking link beneath it.",
      category: "action",
      defaults: { heading: "Ready to get started?", supportingText: "Pick a service and choose a time that suits you.", buttonLabel: "Book service" },
    },
  },
};

export type LibraryEntry = { type: SectionType; variant: string; label: string; description: string; category: SectionCategory };

/** Every section a person may add: each registered type and variant, with its name, description and group. */
export const SECTION_LIBRARY: readonly LibraryEntry[] = SECTION_TYPES.flatMap((type) =>
  SECTION_REGISTRY[type].variants.map((variant) => {
    const meta = VARIANT_META[type][variant.id];
    return { type, variant: variant.id, label: meta.label, description: meta.description, category: meta.category };
  }),
);

/** The name of a variant for a person ("Service cards"); the identifier when it is not known. */
export const variantLabel = (type: SectionType, variant: string): string => VARIANT_META[type][variant]?.label ?? variant;

export const variantDescription = (type: SectionType, variant: string): string => VARIANT_META[type][variant]?.description ?? "";

/** The plain text a new section of this type and variant starts with: every field it declares, valid. A copy, never shared. */
export function defaultPropsFor(type: SectionType, variant: string): Props {
  const defaults = VARIANT_META[type][variant]?.defaults ?? {};
  const props: Props = {};
  for (const field of fieldsOf(type, variant)) if (defaults[field.key] !== undefined) props[field.key] = defaults[field.key];
  return props;
}

/** What a new section is called in the navigator. */
export const defaultLabelFor = (type: SectionType, variant: string): string => variantLabel(type, variant).slice(0, SECTION_LABEL_MAX);

export type VariantSwitch = {
  props: Props;
  /** The names of fields that held text the new style has no place for: the text is removed, so the person is told first. */
  dropped: string[];
  /** The names of fields the new style has that the old one did not: they start with the new style's default text. */
  added: string[];
};

/**
 * The text a section has after its style changes. A field both styles have keeps what was written; a field only the new style has starts
 * with that style's default; a field only the old style had is dropped, and reported when it held something so it is never lost silently.
 */
export function switchVariantProps(type: SectionType, from: string, to: string, props: Props): VariantSwitch {
  const next: Props = {};
  const added: string[] = [];
  const defaults = defaultPropsFor(type, to);
  const newFields = fieldsOf(type, to);
  for (const field of newFields) {
    const kept = props[field.key];
    if (kept !== undefined && (field.kind === "align" || kept.trim() !== "")) next[field.key] = kept;
    else {
      next[field.key] = defaults[field.key] ?? "";
      added.push(fieldLabel(type, to, field));
    }
  }
  const dropped = fieldsOf(type, from)
    .filter((field) => field.kind !== "align" && !newFields.some((candidate) => candidate.key === field.key) && (props[field.key] ?? "").trim() !== "")
    .map((field) => fieldLabel(type, from, field));
  return { props: next, dropped, added };
}
