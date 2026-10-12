/**
 * Site content as DATA, and the rules it must meet: the shape of a template definition, and of a whole Draft being published.
 *
 * A template (`site_templates.definition`) and a Site Version describe the same thing, so they share one shape and one validator:
 *
 *     {
 *       "schema": 1,
 *       "theme":    { ...tokens, see lib/site-theme },
 *       "settings": { "serviceDisplay": { "order": [], "hidden": [] } },
 *       "pages": [
 *         { "key": "home", "title": "Home", "slug": "", "type": "home", "visible": true,
 *           "sections": [ { "key": "hero", "label": "Hero", "type": "hero", "variant": "default", "visible": true,
 *                           "props": { "headline": "...", ... } }, ... ] },
 *         ...
 *       ]
 *     }
 *
 * It selects registered section TYPES and VARIANTS (lib/site-sections) and gives them text. It holds no component, markup, style or script:
 * React components stay in application code, and a definition only chooses which approved component draws which text.
 *
 * Versioning. `schema` is the version of THIS shape. A phase that changes the shape adds a new schema number, a migration for stored
 * definitions and an entry in `SUPPORTED_SCHEMAS`; a definition with any other number is refused rather than guessed at, so an old
 * application never draws a template written for a newer one.
 *
 * Pure: no database, no framework. The database layer and the seed use it to refuse what must not be stored; the tests use it to prove
 * the default template is valid.
 */
import { PAGE_TYPES, type PageType, type VersionSettings } from "@/data/website";
import { PAGE_RULES, REQUIRED_SECTION, isReservedSlug } from "./site-builder-rules";
import { SECTION_LABEL_MAX, isSectionType, validateProps, type Props, type SectionType } from "./site-sections";
import { validateTheme, type SiteTheme } from "./site-theme";

export const TEMPLATE_SCHEMA = 1;
export const SUPPORTED_SCHEMAS: readonly number[] = [TEMPLATE_SCHEMA];

export const MAX_PAGES = 12;
export const MAX_SECTIONS_PER_PAGE = 40;
export const MAX_SERVICE_REFERENCES = 200;

export type ContentSection = { key: string; label: string; type: SectionType; variant: string; visible: boolean; props: Props };
export type ContentPage = { key: string; title: string; slug: string; type: PageType; visible: boolean; sections: ContentSection[] };

/** Everything a Draft says and a template provides. The order of the arrays is the order on the site. */
export type SiteContent = { theme: SiteTheme; settings: VersionSettings; pages: ContentPage[] };
export type TemplateDefinition = SiteContent & { schema: typeof TEMPLATE_SCHEMA };

export type ContentProblem = { page?: string; section?: string; field?: string; message: string };
export type ContentResult = { ok: true; content: SiteContent } | { ok: false; problems: ContentProblem[] };

const PAGE_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const SECTION_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SERVICE_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseServiceDisplay(input: unknown, problems: ContentProblem[]): VersionSettings["serviceDisplay"] {
  const empty = { order: [] as string[], hidden: [] as string[] };
  if (!isRecord(input)) {
    problems.push({ message: "Which Services the site shows was not understood." });
    return empty;
  }
  const read = (value: unknown, label: string): string[] => {
    if (!Array.isArray(value) || value.length > MAX_SERVICE_REFERENCES || value.some((item) => typeof item !== "string" || !SERVICE_REF.test(item) || item.length > 80)) {
      problems.push({ message: `The list of ${label} Services was not understood.` });
      return [];
    }
    return [...new Set(value as string[])];
  };
  return { order: read(input.order, "ordered"), hidden: read(input.hidden, "hidden") };
}

/**
 * Validate a whole site's content: theme, settings and every page and section. All problems are returned, not just the first, so a
 * Publish can say everything that is wrong. Unknown keys are refused, never carried along.
 */
export function validateContent(input: unknown): ContentResult {
  const problems: ContentProblem[] = [];
  if (!isRecord(input)) return { ok: false, problems: [{ message: "The site's content was not understood." }] };

  const theme = validateTheme(input.theme);
  if (!theme.ok) problems.push({ field: "theme", message: theme.error });

  const settings: VersionSettings = isRecord(input.settings) && Object.keys(input.settings).every((key) => key === "serviceDisplay")
    ? { serviceDisplay: parseServiceDisplay(input.settings.serviceDisplay, problems) }
    : (problems.push({ message: "The site's settings were not understood." }), { serviceDisplay: { order: [], hidden: [] } });

  const pages: ContentPage[] = [];
  if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.length > MAX_PAGES) {
    problems.push({ message: `A site has between 1 and ${MAX_PAGES} pages.` });
  } else {
    const keys = new Set<string>();
    const slugs = new Set<string>();
    for (const raw of input.pages as unknown[]) {
      if (!isRecord(raw)) {
        problems.push({ message: "A page was not understood." });
        continue;
      }
      const key = typeof raw.key === "string" && PAGE_KEY.test(raw.key) ? raw.key : undefined;
      if (!key) {
        problems.push({ message: "A page has no valid key." });
        continue;
      }
      if (keys.has(key)) problems.push({ page: key, message: "Two pages have the same key." });
      keys.add(key);

      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (title.length < 1 || title.length > 80) problems.push({ page: key, field: "title", message: "A page title is between 1 and 80 characters." });
      const type = raw.type;
      if (typeof type !== "string" || !(PAGE_TYPES as readonly string[]).includes(type)) problems.push({ page: key, field: "type", message: "That kind of page is not available." });
      const slug = typeof raw.slug === "string" ? raw.slug : undefined;
      if (slug === undefined || (slug !== "" && (!SLUG.test(slug) || slug.length > 80))) problems.push({ page: key, field: "slug", message: "A page address is lower-case words joined by hyphens." });
      else if ((type === "home") !== (slug === "")) problems.push({ page: key, field: "slug", message: "Only the home page has the site's root address." });
      else if (isReservedSlug(slug)) problems.push({ page: key, field: "slug", message: "That address is kept by Climvia. Choose another." });
      else if (slugs.has(slug)) problems.push({ page: key, field: "slug", message: "Two pages have the same address." });
      if (slug !== undefined) slugs.add(slug);
      if (raw.visible !== undefined && typeof raw.visible !== "boolean") problems.push({ page: key, field: "visible", message: "A page is visible or hidden." });

      const sections: ContentSection[] = [];
      if (!Array.isArray(raw.sections) || raw.sections.length > MAX_SECTIONS_PER_PAGE) {
        problems.push({ page: key, message: `A page has up to ${MAX_SECTIONS_PER_PAGE} sections.` });
      } else {
        const sectionKeys = new Set<string>();
        for (const item of raw.sections as unknown[]) {
          if (!isRecord(item)) {
            problems.push({ page: key, message: "A section was not understood." });
            continue;
          }
          const sectionKey = typeof item.key === "string" && SECTION_KEY.test(item.key) ? item.key : undefined;
          if (!sectionKey) {
            problems.push({ page: key, message: "A section has no valid key." });
            continue;
          }
          if (sectionKeys.has(sectionKey)) problems.push({ page: key, section: sectionKey, message: "Two sections on a page have the same key." });
          sectionKeys.add(sectionKey);
          const label = typeof item.label === "string" ? item.label.trim() : "";
          if (label.length < 1 || label.length > SECTION_LABEL_MAX) problems.push({ page: key, section: sectionKey, field: "label", message: `A section name is between 1 and ${SECTION_LABEL_MAX} characters.` });
          if (item.visible !== undefined && typeof item.visible !== "boolean") problems.push({ page: key, section: sectionKey, field: "visible", message: "A section is visible or hidden." });
          const props = validateProps(item.type, item.variant, item.props);
          if (!props.ok) {
            problems.push({ page: key, section: sectionKey, message: props.error });
            for (const [field, message] of Object.entries(props.fields)) problems.push({ page: key, section: sectionKey, field, message });
            continue;
          }
          if (isSectionType(item.type) && typeof item.variant === "string") {
            sections.push({ key: sectionKey, label, type: item.type, variant: item.variant, visible: item.visible !== false, props: props.props });
          }
        }
      }
      if (typeof type === "string" && (PAGE_TYPES as readonly string[]).includes(type) && slug !== undefined) {
        const kind = type as PageType;
        if (raw.visible === false && !PAGE_RULES[kind].hideable) problems.push({ page: key, field: "visible", message: PAGE_RULES[kind].reason ?? "That page can't be hidden." });
        const required = REQUIRED_SECTION[kind];
        if (required && !sections.some((section) => section.type === required.type && section.visible)) problems.push({ page: key, message: required.message });
        pages.push({ key, title, slug, type: kind, visible: raw.visible !== false, sections });
      }
    }
    const homes = pages.filter((page) => page.type === "home");
    if (homes.length !== 1) problems.push({ message: "A site has exactly one home page." });
  }

  if (problems.length > 0 || !theme.ok) return { ok: false, problems };
  return { ok: true, content: { theme: theme.theme, settings, pages } };
}

export type TemplateResult = { ok: true; definition: TemplateDefinition } | { ok: false; problems: ContentProblem[] };

/** A stored or authored template definition, or why it cannot be used. */
export function validateTemplateDefinition(input: unknown): TemplateResult {
  if (!isRecord(input)) return { ok: false, problems: [{ message: "The template was not understood." }] };
  if (typeof input.schema !== "number" || !SUPPORTED_SCHEMAS.includes(input.schema)) {
    return { ok: false, problems: [{ message: `This application does not understand template schema ${String(input.schema)}.` }] };
  }
  const { schema: _schema, ...content } = input;
  void _schema;
  const result = validateContent(content);
  return result.ok ? { ok: true, definition: { schema: TEMPLATE_SCHEMA, ...result.content } } : result;
}
