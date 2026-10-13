/**
 * Phase 15: the rules that stand between what a person (or a forged request) sends and what a Site stores, shows or books, as pure functions:
 * the section registry and its props validation, the theme tokens, the template definition and the whole-site content validation, the
 * domain record's shape, the public booking request and its checks, and the Marketplace listing configuration. No database, no browser: the
 * database holds the same rules again (website-database.spec.ts) and the pages are checked through the running application
 * (website-public.spec.ts).
 */
import { expect, test } from "playwright/test";
import { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { emptyMarketplaceState, getListingServices, sameConfig } from "../src/data/marketplace";
import { checkPublicBooking, parsePublicBooking, bookingReferenceOf, PUBLIC_BOOKING_SERVICE, type PublicBookingRequest } from "../src/lib/public-booking-rules";
import { parseListingConfig } from "../src/lib/marketplace-rules";
import { canonicalUrl, publicListingHref, publicSiteHref } from "../src/lib/site-domain";
import { SECTION_REGISTRY, SECTION_TYPES, TOKENS, fieldsOf, fillTokens, isSectionType, locationOf, readProps, textProblem, validateProps, variantDef } from "../src/lib/site-sections";
import { MAX_PAGES, MAX_SECTIONS_PER_PAGE, validateContent, validateTemplateDefinition } from "../src/lib/site-template";
import { DEFAULT_THEME, accentStyle, readTheme, validateTheme } from "../src/lib/site-theme";
import { moveService, toggleService } from "../src/lib/marketplace-state";
import type { WeeklyHours } from "../src/data/settings";
import { APEX_CONTENT, SERVICES } from "./apex-data";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test.describe("the section registry", () => {
  test("every section type is registered with a label, at least one variant and fields that are plain text or an alignment", () => {
    expect(Object.keys(SECTION_REGISTRY).sort()).toEqual([...SECTION_TYPES].sort());
    for (const type of SECTION_TYPES) {
      const definition = SECTION_REGISTRY[type];
      expect(definition.type).toBe(type);
      expect(definition.label.length, type).toBeGreaterThan(0);
      expect(definition.variants.length, type).toBeGreaterThan(0);
      for (const variant of definition.variants) {
        const keys = fieldsOf(type, variant.id).map((field) => field.key);
        expect(new Set(keys).size, `${type}/${variant.id}`).toBe(keys.length);
        for (const field of fieldsOf(type, variant.id)) expect(["text", "textarea", "align"], `${type}.${field.key}`).toContain(field.kind);
      }
    }
  });

  test("no section type can hold markup, a script, a frame, a handler or a style", () => {
    // The vocabulary of a section is closed: there is no "html", "script", "iframe", "style", "className" or "embed" field anywhere.
    const forbidden = /html|script|iframe|style|class|embed|href|src|onclick/i;
    for (const type of SECTION_TYPES) {
      for (const variant of SECTION_REGISTRY[type].variants) {
        for (const field of fieldsOf(type, variant.id)) expect(field.key, `${type}/${variant.id}`).not.toMatch(forbidden);
      }
    }
    expect(SECTION_TYPES.some((type) => /html|script|iframe|embed|custom/i.test(type))).toBe(false);
  });

  test("an unknown section type or variant fails safely, and says so in words", () => {
    expect(isSectionType("hero")).toBe(true);
    expect(isSectionType("iframe")).toBe(false);
    expect(isSectionType(undefined)).toBe(false);
    expect(variantDef("hero", "default")).toBeDefined();
    expect(variantDef("hero", "fancy")).toBeUndefined();
    const unknownType = validateProps("carousel", "default", {});
    expect(unknownType.ok).toBe(false);
    if (!unknownType.ok) expect(unknownType.error).toBe("That kind of section is not available.");
    const unknownVariant = validateProps("hero", "fancy", {});
    expect(unknownVariant.ok).toBe(false);
    if (!unknownVariant.ok) expect(unknownVariant.error).toBe("That section style is not available.");
    expect(validateProps("hero", 5, {}).ok).toBe(false);
    expect(validateProps("hero", "default", "text").ok).toBe(false);
    expect(validateProps("hero", "default", [{ headline: "x" }]).ok).toBe(false);
  });

  const hero = { headline: "Heating & cooling service", supportingText: "Book with {{business.name}}.", primaryCta: "Book service", secondaryCta: "View services", alignment: "left" };

  test("valid props pass and come back with the declared keys only, in order", () => {
    const result = validateProps("hero", "default", { alignment: "center", secondaryCta: "View services", primaryCta: "Book service", supportingText: "Book with {{business.name}}.", headline: "Heating & cooling service" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.props)).toEqual(["headline", "supportingText", "primaryCta", "secondaryCta", "alignment"]);
      expect(result.props.alignment).toBe("center");
    }
  });

  test("props the section does not declare are refused, never carried along", () => {
    const result = validateProps("hero", "default", { ...hero, onClick: "x", html: "<b>x</b>" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fields).sort()).toEqual(["html", "onClick"]);
  });

  test("markup, script schemes, handlers, control characters and stray tokens are refused in every text field", () => {
    for (const bad of ["<b>bold</b>", "<script>alert(1)</script>", "<iframe src=x>", "javascript:alert(1)", "data: text/html", "vbscript:x", "onerror = alert(1)", "tab\u0007bell", "{{business.phone}}", "{{ business.name }}", "{{"]) {
      expect(textProblem(bad), JSON.stringify(bad)).toBeDefined();
      const result = validateProps("hero", "default", { ...hero, headline: bad });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
    for (const good of ["Heating & cooling service", "Open 7 days — call us", "{{business.name}} in {{business.location}}", "100% satisfaction (guaranteed)"]) {
      expect(textProblem(good), good).toBeUndefined();
    }
  });

  test("limits, empty fields and the alignment choice are enforced", () => {
    expect(validateProps("hero", "default", { ...hero, headline: "x".repeat(81) }).ok).toBe(false);
    expect(validateProps("hero", "default", { ...hero, headline: "   " }).ok).toBe(false);
    expect(validateProps("hero", "default", { ...hero, alignment: "right" }).ok).toBe(false);
    const missing: Record<string, string> = { ...hero };
    delete missing.primaryCta;
    expect(validateProps("hero", "default", missing).ok).toBe(false);
    expect(validateProps("hero", "default", { ...hero, headline: 42 }).ok).toBe(false);
  });

  test("a stored section with a bad value is drawn with what is safe, not with the refused value", () => {
    const props = readProps("hero", "default", { ...hero, headline: "<script>x</script>", primaryCta: "Book service", extra: "ignored", alignment: "right" });
    expect(props.headline).toBeUndefined();
    expect(props.alignment).toBeUndefined();
    expect(props.primaryCta).toBe("Book service");
    expect(Object.keys(props)).not.toContain("extra");
    expect(readProps("hero", "default", null)).toEqual({});
  });

  test("the two text tokens are filled from the organization, and nothing else is", () => {
    expect([...TOKENS]).toEqual(["{{business.name}}", "{{business.location}}"]);
    expect(fillTokens("Welcome to {{business.name}} in {{business.location}}. {{business.name}}!", { name: "Apex", location: "Austin, TX" })).toBe("Welcome to Apex in Austin, TX. Apex!");
    expect(fillTokens("No tokens", { name: "Apex", location: "Austin, TX" })).toBe("No tokens");
    expect(locationOf({ city: "Austin", state: "TX" })).toBe("Austin, TX");
    expect(locationOf({ city: "", state: "TX" })).toBe("TX");
  });
});

test.describe("the theme", () => {
  test("the default theme validates, and unknown settings (CSS, classes, fonts) are refused", () => {
    expect(validateTheme(DEFAULT_THEME).ok).toBe(true);
    for (const extra of [{ css: "body{}" }, { className: "x" }, { customFont: "https://x/f.woff2" }, { background: "url(x)" }]) {
      const result = validateTheme({ ...DEFAULT_THEME, ...extra });
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  test("the accent is a six-digit colour or none, never anything that could be CSS", () => {
    for (const accent of ["#8B3A1E", "#0D5C63", null]) expect(validateTheme({ ...DEFAULT_THEME, accent }).ok, String(accent)).toBe(true);
    for (const accent of ["red", "#fff", "#12345G", "#8b3a1e", "url(javascript:x)", "#000; background:red", "var(--x)", 5, ""]) {
      expect(validateTheme({ ...DEFAULT_THEME, accent }).ok, JSON.stringify(accent)).toBe(false);
    }
  });

  test("radius, density and fonts take only their listed values", () => {
    expect(validateTheme({ ...DEFAULT_THEME, radius: "huge" }).ok).toBe(false);
    expect(validateTheme({ ...DEFAULT_THEME, density: "tight" }).ok).toBe(false);
    expect(validateTheme({ ...DEFAULT_THEME, headingFont: "comic-sans" }).ok).toBe(false);
    expect(validateTheme({ ...DEFAULT_THEME, schema: 2 }).ok).toBe(false);
    expect(validateTheme(null).ok).toBe(false);
    expect(validateTheme([]).ok).toBe(false);
  });

  test("a stored theme that does not validate is replaced by the default, and only the accent becomes style", () => {
    expect(readTheme({ accent: "red" })).toEqual(DEFAULT_THEME);
    expect(readTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(accentStyle(DEFAULT_THEME)).toBeUndefined();
    const style = accentStyle({ ...DEFAULT_THEME, accent: "#8B3A1E" });
    expect(style).toBeDefined();
    expect(Object.keys(style ?? {}).every((key) => key.startsWith("--"))).toBe(true);
    expect(JSON.stringify(style)).toContain("#8B3A1E");
  });
});

test.describe("the template definition and whole-site content", () => {
  test("the default template validates and is exactly Home, Services, About, Contact and Booking", () => {
    expect(DEFAULT_TEMPLATE_KEY).toBe("climvia-starter");
    const result = validateTemplateDefinition(clone(DEFAULT_TEMPLATE));
    expect(result.ok).toBe(true);
    expect(DEFAULT_TEMPLATE.pages.map((page) => page.key)).toEqual(["home", "services", "about", "contact", "booking"]);
    expect(DEFAULT_TEMPLATE.pages.map((page) => page.slug)).toEqual(["", "services", "about", "contact", "booking"]);
    expect(DEFAULT_TEMPLATE.pages.every((page) => page.visible)).toBe(true);
  });

  test("the default template is data only: registered types and variants, plain text, no markup or code", () => {
    for (const page of DEFAULT_TEMPLATE.pages) {
      for (const section of page.sections) {
        expect(isSectionType(section.type), `${page.key}.${section.key}`).toBe(true);
        expect(variantDef(section.type, section.variant), `${page.key}.${section.key}`).toBeDefined();
        expect(validateProps(section.type, section.variant, section.props).ok, `${page.key}.${section.key}`).toBe(true);
      }
    }
    const json = JSON.stringify(DEFAULT_TEMPLATE);
    expect(json).not.toMatch(/<|>|<script|iframe|javascript:|function\s*\(|=>/i);
  });

  test("the default template names no business, phone, email, address or service price: those are read, never copied", () => {
    const json = JSON.stringify(DEFAULT_TEMPLATE);
    for (const value of ["Apex", "Austin", "(512)", "@apex", "Kinney", "$89", "$129", "AC Repair"]) expect(json, value).not.toContain(value);
  });

  test("the approved Apex copy is the template plus one authored heading", () => {
    const template = JSON.stringify(DEFAULT_TEMPLATE.pages);
    const apex = JSON.stringify(APEX_CONTENT.pages);
    expect(apex).not.toBe(template);
    expect(apex.replace("Why customers choose Apex Climate", "Why customers choose {{business.name}}")).toBe(template);
  });

  test("an unsupported schema, an unknown key or an unknown section type is refused with every problem named", () => {
    const base = clone(DEFAULT_TEMPLATE);
    expect(validateTemplateDefinition({ ...base, schema: 99 }).ok).toBe(false);
    expect(validateTemplateDefinition(null).ok).toBe(false);
    const bad = clone(DEFAULT_TEMPLATE);
    bad.pages[0].sections[0].type = "carousel" as never;
    bad.pages[1].sections[0].props = { ...bad.pages[1].sections[0].props, headingHtml: "<b>x</b>" };
    const result = validateContent({ theme: bad.theme, settings: bad.settings, pages: bad.pages });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.length).toBeGreaterThanOrEqual(2);
  });

  test("page structure is enforced: unique keys and addresses, the root only for Home, a bounded size", () => {
    const content = (mutate: (draft: ReturnType<typeof clone<typeof DEFAULT_TEMPLATE>>) => void) => {
      const draft = clone(DEFAULT_TEMPLATE);
      mutate(draft);
      return validateContent({ theme: draft.theme, settings: draft.settings, pages: draft.pages });
    };
    expect(content(() => undefined).ok).toBe(true);
    expect(content((draft) => (draft.pages[1].key = "home")).ok).toBe(false);
    expect(content((draft) => (draft.pages[2].slug = "services")).ok).toBe(false);
    expect(content((draft) => (draft.pages[1].slug = "")).ok).toBe(false);
    expect(content((draft) => (draft.pages[0].slug = "start")).ok).toBe(false);
    expect(content((draft) => (draft.pages[1].slug = "Has Spaces")).ok).toBe(false);
    expect(content((draft) => (draft.pages[1].title = "")).ok).toBe(false);
    expect(content((draft) => (draft.pages[1].type = "carousel" as never)).ok).toBe(false);
    expect(content((draft) => (draft.pages = [])).ok).toBe(false);
    expect(content((draft) => (draft.pages = Array.from({ length: MAX_PAGES + 1 }, (_, index) => ({ ...clone(draft.pages[2]), key: `p${index}`, slug: `p${index}` })))).ok).toBe(false);
    expect(content((draft) => (draft.pages[0].sections = Array.from({ length: MAX_SECTIONS_PER_PAGE + 1 }, (_, index) => ({ ...clone(draft.pages[0].sections[0]), key: `s${index}` })))).ok).toBe(false);
  });

  test("site-wide settings accept a list of service references and nothing else", () => {
    const draft = clone(DEFAULT_TEMPLATE);
    const check = (settings: unknown) => validateContent({ theme: draft.theme, settings, pages: draft.pages }).ok;
    expect(check({ serviceDisplay: { order: ["annual-cooling-tune-up"], hidden: ["furnace-safety-inspection"] } })).toBe(true);
    expect(check({ serviceDisplay: { order: [], hidden: [] } })).toBe(true);
    expect(check({ serviceDisplay: { order: ["Not A Slug"], hidden: [] } })).toBe(false);
    expect(check({ serviceDisplay: { order: [], hidden: "x" } })).toBe(false);
    expect(check({ serviceDisplay: { order: [], hidden: [] }, css: "x" })).toBe(false);
    expect(check({ serviceDisplay: { order: Array.from({ length: 201 }, (_, index) => `s-${index}`), hidden: [] } })).toBe(false);
    expect(check(null)).toBe(false);
  });
});

test.describe("addresses", () => {
  test("a page calls itself by the site's main active custom domain, and by nothing when it has none", () => {
    expect(canonicalUrl(null, "https", "services")).toBeNull();
    expect(canonicalUrl("www.example.com", "https", "")).toBe("https://www.example.com");
    expect(canonicalUrl("www.example.com", "https", "/")).toBe("https://www.example.com");
    expect(canonicalUrl("www.example.com", "https", "services")).toBe("https://www.example.com/services");
    expect(canonicalUrl("www.example.com", "http", "booking/ac-repair")).toBe("http://www.example.com/booking/ac-repair");
  });

  test("public addresses on the platform are paths on this application", () => {
    expect(publicSiteHref("apexclimate")).toBe("/sites/apexclimate");
    expect(publicSiteHref("apexclimate", "/")).toBe("/sites/apexclimate");
    expect(publicSiteHref("apexclimate", "/booking")).toBe("/sites/apexclimate/booking");
    expect(publicListingHref("apex-climate-heating-air")).toBe("/listings/apex-climate-heating-air");
  });
});

test.describe("a public booking request", () => {
  const KEY = "a1b2c3d4e5f6a7b8";
  const request = {
    siteSlug: "apexclimate",
    serviceSlug: "annual-cooling-tune-up",
    submissionKey: KEY,
    date: "2024-10-28",
    start: "09:00",
    end: "10:00",
    name: "Dana Visitor",
    phone: "(512) 555-0188",
    email: "dana@example.test",
    address: "12 Test Street, Austin, TX",
    answers: {},
  };
  const TODAY = "2024-10-25";
  const HOURS: WeeklyHours = { 0: null, 1: { open: "07:30", close: "18:00" }, 2: { open: "07:30", close: "18:00" }, 3: { open: "07:30", close: "18:00" }, 4: { open: "07:30", close: "18:00" }, 5: { open: "07:30", close: "18:00" }, 6: { open: "08:00", close: "14:00" } };
  const service = (id: string) => SERVICES.find((candidate) => candidate.id === id);
  const parsed = (overrides: Record<string, unknown> = {}): PublicBookingRequest => {
    const result = parsePublicBooking({ ...request, ...overrides });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  test("a complete request parses, trimmed, and never carries an organization", () => {
    const value = parsed({ name: "  Dana Visitor  ", organizationId: "00000000-0000-4000-8000-000000000001", organization_id: "x", orgId: "x" });
    expect(value.name).toBe("Dana Visitor");
    expect(Object.keys(value).sort()).toEqual(["address", "answers", "date", "email", "end", "name", "notes", "phone", "serviceSlug", "siteSlug", "start", "submissionKey"].sort());
    expect(JSON.stringify(value)).not.toContain("00000000-0000-4000");
  });

  test("a request that names no site or Service, or a malformed time, key or date, is not understood", () => {
    for (const overrides of [{ siteSlug: "" }, { siteSlug: "Has Caps" }, { siteSlug: "x".repeat(64) }, { serviceSlug: "../etc" }, { submissionKey: "short" }, { submissionKey: "has spaces in it!!" }, { date: "2024-13-40" }, { date: "tomorrow" }, { start: "9am" }, { end: "25:00" }]) {
      const result = parsePublicBooking({ ...request, ...overrides });
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
    }
    for (const input of [null, undefined, "text", 5, []]) expect(parsePublicBooking(input).ok).toBe(false);
  });

  test("contact details are checked field by field with plain-text rules", () => {
    const fields = (overrides: Record<string, unknown>) => {
      const result = parsePublicBooking({ ...request, ...overrides });
      return result.ok ? {} : (result.fields ?? {});
    };
    expect(Object.keys(fields({ name: "" }))).toEqual(["name"]);
    expect(Object.keys(fields({ name: "<b>Dana</b>" }))).toEqual(["name"]);
    expect(Object.keys(fields({ phone: "123" }))).toEqual(["phone"]);
    expect(Object.keys(fields({ email: "not-an-email" }))).toEqual(["email"]);
    expect(Object.keys(fields({ address: "" }))).toEqual(["address"]);
    expect(Object.keys(fields({ notes: "<script>x</script>" }))).toEqual(["notes"]);
    expect(Object.keys(fields({ notes: "x".repeat(1001) }))).toEqual(["notes"]);
    expect(Object.keys(fields({ name: "", email: "bad" })).sort()).toEqual(["email", "name"]);
    expect(parsePublicBooking({ ...request, answers: "x" }).ok).toBe(false);
    expect(parsePublicBooking({ ...request, answers: { q: 5 } }).ok).toBe(false);
  });

  test("a Service the business does not offer online is refused, in the same words for a forged slug as for a retired Service", () => {
    expect(checkPublicBooking(parsed(), undefined, HOURS, TODAY)).toEqual({ ok: false, error: PUBLIC_BOOKING_SERVICE, fields: undefined });
    const internal = { ...service("annual-cooling-tune-up")!, visibility: "internal" as const };
    expect(checkPublicBooking(parsed(), internal, HOURS, TODAY).ok).toBe(false);
    const inactive = { ...service("annual-cooling-tune-up")!, active: false };
    expect(checkPublicBooking(parsed(), inactive, HOURS, TODAY).ok).toBe(false);
    const listedOnly = { ...service("annual-cooling-tune-up")!, visibility: "public-only" as const };
    expect(checkPublicBooking(parsed(), listedOnly, HOURS, TODAY).ok).toBe(false);
  });

  test("the time must be one of the Service's slots on a day the business is open and not in the past", () => {
    const tuneUp = service("annual-cooling-tune-up");
    expect(checkPublicBooking(parsed(), tuneUp, HOURS, TODAY).ok).toBe(true);
    expect(checkPublicBooking(parsed({ date: "2024-10-27" }), tuneUp, HOURS, TODAY).ok).toBe(false); // a Sunday: closed
    expect(checkPublicBooking(parsed({ date: "2024-10-24" }), tuneUp, HOURS, TODAY).ok).toBe(false); // in the past
    expect(checkPublicBooking(parsed({ start: "09:15", end: "10:15" }), tuneUp, HOURS, TODAY).ok).toBe(false); // not a slot
    expect(checkPublicBooking(parsed({ start: "09:00", end: "11:00" }), tuneUp, HOURS, TODAY).ok).toBe(false); // wrong length
    const late = checkPublicBooking(parsed({ date: "2024-10-26", start: "16:00", end: "17:00" }), tuneUp, HOURS, TODAY);
    expect(late.ok).toBe(false); // Saturday closes at 2 PM
  });

  test("intake answers must be among the Service's options, and a required question must be answered", () => {
    const repair = service("ac-repair-diagnostics")!;
    const slot = { date: "2024-10-28", start: "08:00", end: "10:00" };
    expect(checkPublicBooking(parsed({ ...slot, serviceSlug: repair.id }), repair, HOURS, TODAY).ok).toBe(false); // primary issue is required
    const answered = checkPublicBooking(parsed({ ...slot, serviceSlug: repair.id, answers: { "primary-issue": "Blowing warm air", "system-type": "Heat Pump" } }), repair, HOURS, TODAY);
    expect(answered.ok).toBe(true);
    if (answered.ok) {
      expect(answered.value.reportedIssue).toBe("Blowing warm air");
      expect(answered.value.systemType).toBe("Heat Pump");
    }
    expect(checkPublicBooking(parsed({ ...slot, serviceSlug: repair.id, answers: { "primary-issue": "Made up" } }), repair, HOURS, TODAY).ok).toBe(false);
    expect(checkPublicBooking(parsed({ ...slot, serviceSlug: repair.id, answers: { "primary-issue": "Blowing warm air", "not-a-question": "x" } }), repair, HOURS, TODAY).ok).toBe(false);
  });

  test("the visitor's reference is the booking's number", () => {
    expect(bookingReferenceOf(1043)).toBe("BK-1043");
  });
});

test.describe("a Marketplace listing configuration", () => {
  const ids = SERVICES.filter((service) => service.active && service.visibility !== "internal").map((service) => service.id);
  const valid = () => ({
    description: "HVAC maintenance and repair.",
    cover: "teal-horizon",
    order: ids,
    selected: ids.slice(0, 3),
    contact: { phone: true, email: false, address: true, hours: true, website: true },
    actions: { book: true, website: true, contact: false },
  });

  test("a complete configuration parses", () => {
    const result = parseListingConfig(valid());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.selected).toEqual(ids.slice(0, 3));
  });

  test("a description is required, bounded and plain text", () => {
    for (const description of ["", "   ", "x".repeat(301), "<b>x</b>", "javascript:alert(1)", "uses {{business.name}}"]) {
      expect(parseListingConfig({ ...valid(), description }).ok, JSON.stringify(description.slice(0, 20))).toBe(false);
    }
  });

  test("at least one Service must be shown, by slug, once each", () => {
    expect(parseListingConfig({ ...valid(), selected: [] }).ok).toBe(false);
    expect(parseListingConfig({ ...valid(), selected: ["Not A Slug"] }).ok).toBe(false);
    expect(parseListingConfig({ ...valid(), selected: "annual-cooling-tune-up" }).ok).toBe(false);
    const repeated = parseListingConfig({ ...valid(), selected: [ids[0], ids[0]] });
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.value.selected).toEqual([ids[0]]);
  });

  test("covers, contact flags and actions take only their listed values, and nothing extra", () => {
    expect(parseListingConfig({ ...valid(), cover: "neon" }).ok).toBe(false);
    expect(parseListingConfig({ ...valid(), cover: null }).ok).toBe(true);
    expect(parseListingConfig({ ...valid(), contact: { phone: true } }).ok).toBe(false);
    expect(parseListingConfig({ ...valid(), contact: { ...valid().contact, fax: true } }).ok).toBe(false);
    expect(parseListingConfig({ ...valid(), actions: { ...valid().actions, buy: true } }).ok).toBe(false);
    expect(parseListingConfig({ ...valid(), actions: { book: "yes", website: true, contact: true } }).ok).toBe(false);
    expect(parseListingConfig(null).ok).toBe(false);
  });

  test("the first-time setup selects every public Service, and the listing shows the selected ones in its own order", () => {
    const state = emptyMarketplaceState(SERVICES);
    expect(state.status).toBe("not-set-up");
    expect(state.config.selected).toEqual(ids);
    const config = { ...state.config, selected: ["furnace-safety-inspection", "annual-cooling-tune-up"], order: [...ids].reverse() };
    expect(getListingServices(config, SERVICES).map((service) => service.id)).toEqual(["furnace-safety-inspection", "annual-cooling-tune-up"]);
    expect(sameConfig({ ...config, selected: [...config.selected].reverse() }, config)).toBe(true);
    const toggled = toggleService(state.config, "annual-cooling-tune-up", false);
    expect(toggled.selected).not.toContain("annual-cooling-tune-up");
    expect(moveService(state.config, ids[0], 1).order[1]).toBe(ids[0]);
  });
});
