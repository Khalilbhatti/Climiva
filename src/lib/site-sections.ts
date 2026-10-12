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

export const SECTION_REGISTRY: Readonly<Record<SectionType, SectionTypeDef>> = {
  hero: {
    type: "hero",
    label: "Hero",
    summary: "Headline, supporting text and buttons",
    variants: [{ id: "default" }],
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
    variants: [
      { id: "cards", connected: "services", fields: HEADING_AND_TEXT },
      { id: "catalog", connected: "services", fields: [] },
      { id: "booking", connected: "booking", fields: [] },
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
    variants: [{ id: "default" }],
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
