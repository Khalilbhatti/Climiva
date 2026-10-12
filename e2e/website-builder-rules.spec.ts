/**
 * Phase 16: the Website Builder's editing core as pure functions, with no browser and no database: what each edit does to the content of a
 * Draft, what it refuses and why, the structural rules the Builder and the server share, the theme tokens, and the working-copy state with its
 * undo history (cap, coalescing, Save and Discard). The screens and the database are checked in website-builder.spec.ts and
 * website-builder-db.spec.ts; this is where every rule is checked once, exactly.
 */
import { expect, test } from "playwright/test";
import { DEFAULT_TEMPLATE } from "../src/db/default-template";
import {
  HISTORY_LIMIT,
  addPage,
  addSection,
  builderReducer,
  changeSectionVariant,
  contentOf,
  duplicatePage,
  duplicateSection,
  homeOf,
  initialBuilderState,
  isDirty,
  moveSection,
  moveSectionBy,
  movePage,
  movePageBy,
  normalizeSlugInput,
  pageDeleteLock,
  pageHideLock,
  pageIn,
  pageProblems,
  pageSlugLock,
  problemsOf,
  removePage,
  removeSection,
  sectionIn,
  sectionLock,
  sectionProblems,
  setSectionLabel,
  setSectionProp,
  setSectionVisible,
  setServiceDisplay,
  setTheme,
  updatePage,
  versionOfContent,
  type BuilderAction,
  type BuilderState,
  type Change,
} from "../src/lib/site-builder";
import { problemFields } from "../src/lib/site-builder-fields";
import { PAGE_RULES, REQUIRED_SECTION, RESERVED_PAGE_SLUGS, STALE_DRAFT, copyKey, numberedKey, slugify, uniqueSlug } from "../src/lib/site-builder-rules";
import {
  SECTION_CATEGORIES,
  SECTION_LIBRARY,
  SECTION_REGISTRY,
  SECTION_TYPES,
  defaultLabelFor,
  defaultPropsFor,
  switchVariantProps,
  validateProps,
  variantDescription,
  variantLabel,
} from "../src/lib/site-sections";
import { MAX_PAGES, MAX_SECTIONS_PER_PAGE, validateContent, type SiteContent } from "../src/lib/site-template";
import { THEME_FONTS, THEME_RADII, themeAttributes, themeStyle } from "../src/lib/site-theme";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The default template as content (a Draft made from it, before anyone edits it). */
function base(): SiteContent {
  const { theme, settings, pages } = clone(DEFAULT_TEMPLATE);
  return { theme, settings, pages };
}

/** The content a change produced, or the failure of the test when it was refused. */
function made(change: Change): SiteContent {
  if (!change.ok) throw new Error(`Refused: ${change.error}`);
  return change.content;
}

const refusal = (change: Change): string => {
  if (change.ok) throw new Error("Expected the change to be refused.");
  return change.error;
};

const apply = (state: BuilderState, change: (content: SiteContent) => Change, coalesce?: string): BuilderState => builderReducer(state, { type: "apply", change, coalesce });
const prop = (field: string, value: string) => (content: SiteContent): Change => ({ ok: true, content: setSectionProp(content, "home", "hero", field, value) });
const headlineOf = (state: BuilderState): string => sectionIn(state.present, "home", "hero")!.props.headline;

test.describe("the Draft as content", () => {
  test("a stored version becomes editable content and back without losing or inventing anything", () => {
    const content = base();
    expect(contentOf(versionOfContent(content))).toEqual(content);
    const version = versionOfContent(content);
    expect(version.status).toBe("draft");
    expect(version.pages.map((page) => page.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    // The renderer is given keys as identities: nothing in it names a database row.
    expect(version.pages.every((page) => page.id === page.key)).toBe(true);
  });

  test("the default content has no problems, and the Builder's check is the server's check", () => {
    expect(problemsOf(base())).toEqual([]);
    expect(validateContent(base()).ok).toBe(true);
  });
});

test.describe("sections", () => {
  test("a text change keeps the text as typed, changes only that field of that section, and a same-value change changes nothing", () => {
    const content = base();
    const next = setSectionProp(content, "home", "hero", "headline", "  Cool homes  ");
    expect(sectionIn(next, "home", "hero")!.props.headline).toBe("  Cool homes  ");
    expect(sectionIn(next, "home", "hero")!.props.primaryCta).toBe(sectionIn(content, "home", "hero")!.props.primaryCta);
    expect(sectionIn(content, "home", "hero")!.props.headline).not.toBe("  Cool homes  ");
    expect(setSectionProp(content, "home", "hero", "headline", sectionIn(content, "home", "hero")!.props.headline)).toBe(content);
    expect(setSectionProp(content, "home", "nope", "headline", "x")).toBe(content);
    expect(setSectionProp(content, "nope", "hero", "headline", "x")).toBe(content);
  });

  test("a section name is bounded and an invalid text is reported by the same check the server runs, never silently changed", () => {
    const content = base();
    expect(sectionIn(setSectionLabel(content, "home", "hero", "x".repeat(200)), "home", "hero")!.label.length).toBe(60);
    for (const [field, value] of [
      ["headline", "<img src=x onerror=alert(1)>"],
      ["headline", "javascript:alert(1)"],
      ["headline", ""],
      ["headline", "x".repeat(81)],
      ["supportingText", "Hello {{business.phone}}"],
      ["alignment", "right"],
    ] as const) {
      const next = setSectionProp(content, "home", "hero", field, value);
      expect(sectionIn(next, "home", "hero")!.props[field], `${field}=${value}`).toBe(value);
      expect(problemsOf(next).length, `${field}=${value}`).toBeGreaterThan(0);
      expect(Object.keys(sectionProblems(problemsOf(next), "home", "hero")), `${field}=${value}`).toContain(field);
    }
    expect(problemsOf(setSectionProp(content, "home", "hero", "supportingText", "Welcome to {{business.name}} in {{business.location}}"))).toEqual([]);
  });

  test("every section in the library can be added: it starts with its registered default text, valid, and is selected", () => {
    expect(SECTION_LIBRARY.length).toBe(SECTION_TYPES.reduce((total, type) => total + SECTION_REGISTRY[type].variants.length, 0));
    for (const entry of SECTION_LIBRARY) {
      const change = addSection(base(), "about", entry.type, entry.variant);
      const content = made(change);
      const added = pageIn(content, "about")!.sections.at(-1)!;
      expect(added, `${entry.type}/${entry.variant}`).toMatchObject({ type: entry.type, variant: entry.variant, visible: true, label: defaultLabelFor(entry.type, entry.variant) });
      expect(added.props).toEqual(defaultPropsFor(entry.type, entry.variant));
      expect(problemsOf(content), `${entry.type}/${entry.variant}`).toEqual([]);
      expect(change.ok && change.select).toEqual({ kind: "section", page: "about", section: added.key });
      expect(validateProps(entry.type, entry.variant, added.props).ok).toBe(true);
    }
    // Every library entry has a name, a description and a known group.
    for (const entry of SECTION_LIBRARY) {
      expect(variantLabel(entry.type, entry.variant).length).toBeGreaterThan(0);
      expect(variantDescription(entry.type, entry.variant).length).toBeGreaterThan(10);
      expect(SECTION_CATEGORIES.map((category) => category.id)).toContain(entry.category);
    }
  });

  test("a new section goes after the selected one (or last), gets its own key, and only a registered type can be added", () => {
    const content = base();
    const after = made(addSection(content, "home", "rich_text", "default", "hero"));
    expect(pageIn(after, "home")!.sections.map((section) => section.key).slice(0, 3)).toEqual(["hero", "rich_text-1", "services"]);
    const twice = made(addSection(after, "home", "rich_text", "default"));
    expect(pageIn(twice, "home")!.sections.at(-1)!.key).toBe("rich_text-2");
    expect(new Set(pageIn(twice, "home")!.sections.map((section) => section.key)).size).toBe(pageIn(twice, "home")!.sections.length);
    expect(refusal(addSection(content, "home", "carousel" as never, "default"))).toMatch(/not available/);
    expect(refusal(addSection(content, "nope", "hero", "default"))).toMatch(/no longer exists/);
    // Adding is not a change to the stored Draft: the content it came from is untouched.
    expect(pageIn(content, "home")!.sections).toHaveLength(6);
  });

  test("a page holds up to the section limit and a section can be added or copied only while there is room", () => {
    let content = base();
    while (pageIn(content, "about")!.sections.length < MAX_SECTIONS_PER_PAGE) content = made(addSection(content, "about", "rich_text", "default"));
    expect(pageIn(content, "about")!.sections).toHaveLength(MAX_SECTIONS_PER_PAGE);
    expect(problemsOf(content)).toEqual([]);
    expect(refusal(addSection(content, "about", "rich_text", "default"))).toMatch(/up to 40/);
    expect(refusal(duplicateSection(content, "about", "intro"))).toMatch(/up to 40/);
  });

  test("a copy follows its source with the same text under a new key, and editing one never changes the other", () => {
    const content = base();
    const once = made(duplicateSection(content, "home", "hero"));
    expect(pageIn(once, "home")!.sections.map((section) => section.key).slice(0, 3)).toEqual(["hero", "hero-copy", "services"]);
    expect(sectionIn(once, "home", "hero-copy")!.props).toEqual(sectionIn(once, "home", "hero")!.props);
    const edited = setSectionProp(once, "home", "hero-copy", "headline", "Only the copy");
    expect(sectionIn(edited, "home", "hero")!.props.headline).toBe(sectionIn(content, "home", "hero")!.props.headline);
    const twice = made(duplicateSection(once, "home", "hero"));
    expect(pageIn(twice, "home")!.sections.map((section) => section.key)).toContain("hero-copy-2");
    expect(problemsOf(twice)).toEqual([]);
  });

  test("a section can be removed, selecting the one that took its place; a section the page cannot do without is kept and says why", () => {
    const content = base();
    const change = removeSection(content, "home", "hero");
    expect(made(change).pages[0].sections.map((section) => section.key)).toEqual(["services", "why", "hours", "contact", "bookingCta"]);
    expect(change.ok && change.select).toEqual({ kind: "section", page: "home", section: "services" });
    const last = removeSection(content, "home", "bookingCta");
    expect(last.ok && last.select).toEqual({ kind: "section", page: "home", section: "contact" });

    const booking = REQUIRED_SECTION.booking!;
    expect(sectionLock(content, "booking", "experience")).toBe(booking.message);
    expect(refusal(removeSection(content, "booking", "experience"))).toBe(booking.message);
    expect(refusal(setSectionVisible(content, "booking", "experience", false))).toBe(booking.message);
    expect(sectionLock(content, "booking", "intro")).toBeUndefined();
    // With a second visible list of Services the first is no longer required.
    const two = made(addSection(content, "booking", "service_list", "booking"));
    expect(sectionLock(two, "booking", "experience")).toBeUndefined();
    expect(problemsOf(made(removeSection(two, "booking", "experience")))).toEqual([]);
    // A removed page's last section leaves the page selected.
    const empty = made(removeSection(made(removeSection(made(removeSection(content, "services", "intro")), "services", "bookingCta")), "services", "catalog"));
    expect(pageIn(empty, "services")!.sections).toEqual([]);
    expect(problemsOf(empty)).toEqual([]);
  });

  test("a section can be hidden and shown, and a hidden section stays in the Draft", () => {
    const content = base();
    const hidden = made(setSectionVisible(content, "home", "hero", false));
    expect(sectionIn(hidden, "home", "hero")!.visible).toBe(false);
    expect(pageIn(hidden, "home")!.sections).toHaveLength(6);
    expect(problemsOf(hidden)).toEqual([]);
    expect(sectionIn(made(setSectionVisible(hidden, "home", "hero", true)), "home", "hero")!.visible).toBe(true);
    expect(made(setSectionVisible(content, "home", "hero", true))).toBe(content);
    expect(refusal(setSectionVisible(content, "home", "nope", false))).toMatch(/no longer exists/);
  });

  test("a section moves to a position, one step, or not at all at the ends", () => {
    const content = base();
    const keys = (value: SiteContent) => pageIn(value, "home")!.sections.map((section) => section.key);
    expect(keys(moveSection(content, "home", "hero", 2))).toEqual(["services", "why", "hero", "hours", "contact", "bookingCta"]);
    expect(keys(moveSection(content, "home", "bookingCta", 0))).toEqual(["bookingCta", "hero", "services", "why", "hours", "contact"]);
    expect(keys(moveSection(content, "home", "hero", 99))).toEqual(["services", "why", "hours", "contact", "bookingCta", "hero"]);
    expect(moveSection(content, "home", "hero", 0)).toBe(content);
    expect(moveSectionBy(content, "home", "hero", -1)).toBe(content);
    expect(moveSectionBy(content, "home", "bookingCta", 1)).toBe(content);
    expect(keys(moveSectionBy(content, "home", "hero", 1))).toEqual(["services", "hero", "why", "hours", "contact", "bookingCta"]);
    expect(moveSection(content, "home", "nope", 1)).toBe(content);
  });

  test("changing a section's style keeps the text both styles have, starts new fields with the style's text, and reports what would be lost", () => {
    const content = base();
    const cards = sectionIn(content, "home", "services")!;
    expect(cards.variant).toBe("cards");
    const toCatalog = switchVariantProps("service_list", "cards", "catalog", cards.props);
    expect(toCatalog.dropped).toEqual(["Heading", "Supporting text"]);
    expect(toCatalog.props).toEqual({});
    const changed = changeSectionVariant(content, "home", "services", "catalog");
    expect(made(changed)).toBeDefined();
    expect(changed.ok && (changed as { dropped?: string[] }).dropped).toEqual(["Heading", "Supporting text"]);
    expect(sectionIn(made(changed), "home", "services")).toMatchObject({ variant: "catalog", props: {} });
    expect(problemsOf(made(changed))).toEqual([]);

    // Icons -> plain keeps the heading and the three points, and adds an introduction.
    const why = sectionIn(content, "home", "why")!;
    const plain = switchVariantProps("feature_list", "icons", "plain", why.props);
    expect(plain.dropped).toEqual([]);
    expect(plain.props.heading).toBe(why.props.heading);
    expect(plain.props.item1Title).toBe(why.props.item1Title);
    expect(plain.added).toEqual(["Supporting text"]);
    expect(plain.props.supportingText).toBeTruthy();
    // Back again loses the introduction that was added: it is reported only when it holds text.
    expect(switchVariantProps("feature_list", "plain", "icons", plain.props).dropped).toEqual(["Supporting text"]);
    expect(switchVariantProps("feature_list", "plain", "icons", { ...plain.props, supportingText: "  " }).dropped).toEqual([]);
    expect(made(changeSectionVariant(content, "home", "hero", "default"))).toBe(content);
  });

  test("from every style to every other style of a type, the text that results is valid for the new style", () => {
    for (const type of SECTION_TYPES) {
      const variants = SECTION_REGISTRY[type].variants.map((variant) => variant.id);
      for (const from of variants) {
        for (const to of variants) {
          const result = switchVariantProps(type, from, to, defaultPropsFor(type, from));
          expect(validateProps(type, to, result.props).ok, `${type}: ${from} -> ${to}`).toBe(true);
        }
      }
    }
  });
});

test.describe("pages", () => {
  test("a new page is a standard page with a key, a unique address and one page-heading section, valid and selected", () => {
    const content = base();
    const change = addPage(content);
    const next = made(change);
    expect(next.pages).toHaveLength(6);
    expect(next.pages.at(-1)).toMatchObject({ key: "page-1", title: "New page", slug: "new-page", type: "content", visible: true });
    expect(next.pages.at(-1)!.sections.map((section) => section.type)).toEqual(["page_intro"]);
    expect(change.ok && change.select).toEqual({ kind: "page", page: "page-1" });
    expect(problemsOf(next)).toEqual([]);
    const again = made(addPage(next));
    expect(again.pages.at(-1)).toMatchObject({ key: "page-2", slug: "new-page-2" });
    // No second home page, ever: a new page never has the root address.
    expect(again.pages.filter((page) => page.type === "home")).toHaveLength(1);
    expect(again.pages.filter((page) => page.slug === "")).toHaveLength(1);
    // No sample business content: a new page names nothing.
    expect(JSON.stringify(next.pages.at(-1))).not.toMatch(/Apex|Austin|\(512\)/);
  });

  test("a page title that is a reserved word is given another address, and every reserved word is refused by the content check", () => {
    for (const word of RESERVED_PAGE_SLUGS) {
      const next = made(addPage(base(), word));
      expect(next.pages.at(-1)!.slug, word).not.toBe(word);
      expect(problemsOf(next), word).toEqual([]);
      // Forced by hand (a request that does not come from the Builder), the word is refused: "_next" is not even an address's shape.
      const forced = pageProblems(problemsOf(made(updatePage(next, "page-1", { slug: word }))), "page-1").slug;
      expect(forced, word).toBe(word.startsWith("_") ? "A page address is lower-case words joined by hyphens." : "That address is kept by Climvia. Choose another.");
    }
    expect(RESERVED_PAGE_SLUGS).toEqual(expect.arrayContaining(["api", "admin", "login", "settings", "sites", "listings", "marketplace", "website", "_next"]));
  });

  test("addresses are made lower-case words joined by hyphens while typing, and a collision is reported on the page that has it", () => {
    // A trailing hyphen is kept while typing (the next word is coming); the screen drops it when the field is left.
    for (const [typed, expected] of [
      ["About Us!", "about-us-"],
      ["About Us", "about-us"],
      [" Leading", "leading"],
      ["UPPER", "upper"],
      ["a--b", "a-b"],
      ["Spring Offers 2026", "spring-offers-2026"],
      ["---x", "x"],
      ["", ""],
      ["!!!", ""],
    ] as const) {
      expect(normalizeSlugInput(typed), typed).toBe(expected);
    }
    expect(normalizeSlugInput("x".repeat(200))).toHaveLength(80);
    expect(slugify("Crème Brûlée & Co.")).toBe("creme-brulee-co");
    expect(uniqueSlug("services", new Set(["services"]))).toBe("services-2");
    expect(uniqueSlug("Services", new Set(["services", "services-2"]))).toBe("services-3");
    expect(uniqueSlug("!!!", new Set())).toBe("page");

    // "About" typed by hand is "about", the address About already has.
    const clash = made(updatePage(made(addPage(base())), "page-1", { slug: normalizeSlugInput("About") }));
    const problems = problemsOf(clash);
    expect(problems.map((problem) => problem.message)).toContain("Two pages have the same address.");
    expect(pageProblems(problems, "page-1").slug).toBe("Two pages have the same address.");
    // A trailing hyphen (a word still being typed) is not an address yet.
    const typing = made(updatePage(made(addPage(base())), "page-1", { slug: "my-" }));
    expect(pageProblems(problemsOf(typing), "page-1").slug).toMatch(/lower-case words joined by hyphens/);
  });

  test("the home page and the booking page are structural: they cannot be deleted or hidden, and the home page's address cannot change", () => {
    const content = base();
    expect(pageDeleteLock(content, "home")).toBe(PAGE_RULES.home.reason);
    expect(pageHideLock(content, "home")).toBe(PAGE_RULES.home.reason);
    expect(pageSlugLock(content, "home")).toBe(PAGE_RULES.home.reason);
    expect(pageDeleteLock(content, "booking")).toBe(PAGE_RULES.booking.reason);
    expect(pageHideLock(content, "booking")).toBe(PAGE_RULES.booking.reason);
    expect(pageSlugLock(content, "booking")).toBeUndefined();
    for (const key of ["services", "about", "contact"]) {
      expect(pageDeleteLock(content, key), key).toBeUndefined();
      expect(pageHideLock(content, key), key).toBeUndefined();
      expect(pageSlugLock(content, key), key).toBeUndefined();
    }
    expect(refusal(removePage(content, "home"))).toBe(PAGE_RULES.home.reason);
    expect(refusal(removePage(content, "booking"))).toBe(PAGE_RULES.booking.reason);
    expect(refusal(updatePage(content, "home", { slug: "start" }))).toBe(PAGE_RULES.home.reason);
    expect(refusal(updatePage(content, "home", { visible: false }))).toBe(PAGE_RULES.home.reason);
    expect(refusal(updatePage(content, "booking", { visible: false }))).toBe(PAGE_RULES.booking.reason);
    expect(refusal(updatePage(content, "nope", { title: "x" }))).toMatch(/no longer exists/);
    // The same rules hold when the content is checked by the server's validation, whoever sent it.
    const homeHidden = clone(content);
    homeHidden.pages[0].visible = false;
    expect(problemsOf(homeHidden).map((problem) => problem.message)).toContain(PAGE_RULES.home.reason);
    const noHome = clone(content);
    noHome.pages.shift();
    expect(problemsOf(noHome).map((problem) => problem.message)).toContain("A site has exactly one home page.");
    const twoHomes = clone(content);
    twoHomes.pages[1].type = "home";
    expect(problemsOf(twoHomes).length).toBeGreaterThan(0);
    const bookingWithoutList = clone(content);
    bookingWithoutList.pages[4].sections = bookingWithoutList.pages[4].sections.filter((section) => section.type !== "service_list");
    expect(problemsOf(bookingWithoutList).map((problem) => problem.message)).toContain(REQUIRED_SECTION.booking!.message);
  });

  test("a page can be renamed, re-addressed, hidden and shown; its title and address are checked like the server's", () => {
    let content = made(addPage(base()));
    content = made(updatePage(content, "page-1", { title: "Spring offers", slug: "spring-offers" }));
    expect(pageIn(content, "page-1")).toMatchObject({ title: "Spring offers", slug: "spring-offers", visible: true });
    expect(problemsOf(content)).toEqual([]);
    content = made(updatePage(content, "page-1", { visible: false }));
    expect(pageIn(content, "page-1")!.visible).toBe(false);
    expect(problemsOf(content)).toEqual([]);
    expect(pageIn(made(updatePage(content, "page-1", { visible: true })), "page-1")!.visible).toBe(true);
    expect(pageProblems(problemsOf(made(updatePage(content, "page-1", { title: "" }))), "page-1").title).toMatch(/between 1 and 80/);
    expect(pageProblems(problemsOf(made(updatePage(content, "page-1", { title: "x".repeat(81) }))), "page-1").title).toMatch(/between 1 and 80/);
    // The booking page may change its address (the booking links follow it).
    expect(problemsOf(made(updatePage(base(), "booking", { slug: "reserve" })))).toEqual([]);
  });

  test("a copy of a page is a standard page with a new key, a unique title and address, and copies of its sections", () => {
    const content = base();
    for (const key of ["home", "services", "booking"]) {
      const next = made(duplicatePage(content, key));
      const copy = next.pages[next.pages.findIndex((page) => page.key === key) + 1];
      expect(copy, key).toMatchObject({ type: "content", title: `${pageIn(content, key)!.title} (copy)` });
      expect(copy.slug, key).not.toBe("");
      expect(next.pages.filter((page) => page.type === "home"), key).toHaveLength(1);
      expect(next.pages.filter((page) => page.type === "booking").length, key).toBeLessThanOrEqual(1);
      expect(copy.sections.map((section) => section.key)).toEqual(pageIn(content, key)!.sections.map((section) => section.key));
      expect(problemsOf(next), key).toEqual([]);
    }
    const next = made(duplicatePage(content, "services"));
    expect(next.pages[2]).toMatchObject({ key: "page-1", slug: "services-copy" });
    expect(made(duplicatePage(next, "services")).pages[2].slug).toBe("services-copy-2");
    // The copy's text is its own.
    const edited = setSectionProp(next, "page-1", "intro", "heading", "Only the copy");
    expect(sectionIn(edited, "services", "intro")!.props.heading).not.toBe("Only the copy");
  });

  test("a page can be deleted unless it is structural, and the next page is selected; the site never has more than the page limit", () => {
    const content = base();
    const change = removePage(content, "about");
    expect(made(change).pages.map((page) => page.key)).toEqual(["home", "services", "contact", "booking"]);
    expect(change.ok && change.select).toEqual({ kind: "page", page: "services" });
    expect(problemsOf(made(change))).toEqual([]);

    let full = base();
    while (full.pages.length < MAX_PAGES) full = made(addPage(full));
    expect(full.pages).toHaveLength(MAX_PAGES);
    expect(problemsOf(full)).toEqual([]);
    expect(refusal(addPage(full))).toMatch(/up to 12 pages/);
    expect(refusal(duplicatePage(full, "about"))).toMatch(/up to 12 pages/);
  });

  test("page order is the site's menu order: the home page stays first and a page can be moved only among the others", () => {
    const content = base();
    const keys = (value: SiteContent) => value.pages.map((page) => page.key);
    expect(keys(movePage(content, "booking", 0))).toEqual(["home", "booking", "services", "about", "contact"]);
    expect(keys(movePage(content, "booking", 1))).toEqual(["home", "booking", "services", "about", "contact"]);
    expect(keys(movePageBy(content, "about", 1))).toEqual(["home", "services", "contact", "about", "booking"]);
    expect(keys(movePageBy(content, "about", -1))).toEqual(["home", "about", "services", "contact", "booking"]);
    expect(movePage(content, "home", 3)).toBe(content);
    expect(movePageBy(content, "services", -1)).toBe(content);
    expect(movePageBy(content, "booking", 1)).toBe(content);
    expect(homeOf(movePage(content, "contact", 0))!.key).toBe("home");
    expect(movePage(content, "contact", 0).pages[0].key).toBe("home");
  });

  test("keys are deterministic and unique", () => {
    expect(numberedKey("page", new Set(["page-1", "page-2"]), 40)).toBe("page-3");
    expect(copyKey("hero", new Set(["hero-copy"]), 40)).toBe("hero-copy-2");
    expect(copyKey("x".repeat(60), new Set(), 40)).toHaveLength(40);
  });
});

test.describe("the theme and the services list", () => {
  test("a theme change merges into the theme, changes nothing else, and a same-value change changes nothing", () => {
    const content = base();
    const next = setTheme(content, { accent: "#8B3A1E", radius: "large", density: "compact", headingFont: "serif" });
    expect(next.theme).toMatchObject({ accent: "#8B3A1E", radius: "large", density: "compact", headingFont: "serif", bodyFont: "inter" });
    expect(next.pages).toBe(content.pages);
    expect(problemsOf(next)).toEqual([]);
    expect(setTheme(content, { radius: content.theme.radius })).toBe(content);
  });

  test("the theme holds only its tokens: an invalid value is reported by the same check as the server's, and no CSS can be set", () => {
    const content = base();
    for (const patch of [{ accent: "red" }, { accent: "#fff" }, { accent: "#000; background:red" }, { radius: "huge" }, { density: "tight" }, { headingFont: "comic-sans" }, { bodyFont: "https://x/f.woff2" }]) {
      const next = setTheme(content, patch as never);
      expect(problemsOf(next).some((problem) => problem.field === "theme"), JSON.stringify(patch)).toBe(true);
    }
    expect(THEME_FONTS).toEqual(["inter", "system-sans", "serif"]);
    expect(THEME_RADII).toEqual(["small", "medium", "large"]);
    // What a theme turns into is custom properties only, built from validated tokens.
    const style = themeStyle({ ...content.theme, accent: "#8B3A1E", radius: "small", headingFont: "serif" });
    expect(Object.keys(style).every((key) => key.startsWith("--"))).toBe(true);
    expect(Object.values(style).join(" ")).not.toMatch(/url\(|javascript:|expression|;|\{|\}/i);
    expect(style["--color-primary"]).toBe("#8B3A1E");
    expect(themeAttributes({ ...content.theme, density: "compact" })).toEqual({ "data-site-theme": "", "data-site-density": "compact" });
    expect(Object.keys(themeStyle(content.theme))).not.toContain("--color-primary");
  });

  test("the services list the site shows is a list of references, replaced whole, and a same list changes nothing", () => {
    const content = base();
    const next = setServiceDisplay(content, { order: ["furnace-safety-inspection"], hidden: ["annual-cooling-tune-up"] });
    expect(next.settings.serviceDisplay).toEqual({ order: ["furnace-safety-inspection"], hidden: ["annual-cooling-tune-up"] });
    expect(problemsOf(next)).toEqual([]);
    expect(setServiceDisplay(content, { order: [], hidden: [] })).toBe(content);
    expect(problemsOf(setServiceDisplay(content, { order: ["Not A Slug"], hidden: [] })).length).toBeGreaterThan(0);
  });
});

test.describe("where a problem is", () => {
  test("problems are keyed by page, section and field for the screen and for the server's answer", () => {
    const content = setSectionProp(setSectionProp(base(), "home", "hero", "headline", ""), "about", "intro", "supportingText", "<b>x</b>");
    const problems = problemsOf(content);
    const fields = problemFields(problems);
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["home.hero", "home.hero.headline", "about.intro.supportingText"]));
    expect(sectionProblems(problems, "home", "hero").headline).toBeTruthy();
    expect(sectionProblems(problems, "about", "intro").supportingText).toBeTruthy();
    expect(sectionProblems(problems, "about", "business")).toEqual({});
    expect(problemFields([{ message: "x" }])).toEqual({ content: "x" });
    expect(problemFields([{ page: "home", field: "title", message: "a" }, { page: "home", field: "title", message: "b" }])).toEqual({ "home.title": "a" });
  });

  test("the stale-draft sentence is one sentence, for every screen", () => {
    expect(STALE_DRAFT).toBe("This website was changed somewhere else after you opened it, so your changes were not saved. Reload to see the latest version.");
  });
});

test.describe("the working copy, its history, Save and Discard", () => {
  const start = () => initialBuilderState(base());

  test("a new Builder opens on the home page with the page selected and nothing unsaved or to undo", () => {
    const state = start();
    expect(state).toMatchObject({ page: "home", selection: { kind: "page", page: "home" }, past: [], future: [], notice: null });
    expect(isDirty(state)).toBe(false);
    expect(initialBuilderState(base(), "about").page).toBe("about");
    expect(initialBuilderState(base(), "no-such-page").page).toBe("home");
  });

  test("an edit is unsaved, Undo takes it back (and the content is clean again), Redo brings it back, and a new edit ends the redo", () => {
    let state = apply(start(), prop("headline", "One"));
    expect(isDirty(state)).toBe(true);
    expect(headlineOf(state)).toBe("One");
    state = builderReducer(state, { type: "undo" });
    expect(isDirty(state)).toBe(false);
    expect(state.future).toHaveLength(1);
    state = builderReducer(state, { type: "redo" });
    expect(headlineOf(state)).toBe("One");
    state = builderReducer(builderReducer(state, { type: "undo" }), { type: "undo" });
    expect(isDirty(state)).toBe(false);
    state = apply(builderReducer(state, { type: "redo" }), prop("headline", "Two"));
    expect(state.future).toEqual([]);
    expect(builderReducer(state, { type: "redo" })).toBe(state);
    // Undoing when there is nothing to undo changes nothing.
    expect(builderReducer(start(), { type: "undo" })).toEqual(start());
  });

  test("typing in one field is one step; stopping (or another field) starts a new step", () => {
    let state = start();
    for (const text of ["H", "He", "Hel", "Hell", "Hello"]) state = apply(state, prop("headline", text), "prop:home/hero/headline");
    expect(state.past).toHaveLength(1);
    state = builderReducer(state, { type: "undo" });
    expect(isDirty(state)).toBe(false);
    state = apply(start(), prop("headline", "A"), "prop:home/hero/headline");
    state = apply(state, prop("primaryCta", "Go"), "prop:home/hero/primaryCta");
    state = apply(state, prop("headline", "AB"), "prop:home/hero/headline");
    expect(state.past).toHaveLength(3);
    // Leaving the field ends the step even for the same field.
    state = apply(start(), prop("headline", "A"), "prop:home/hero/headline");
    state = builderReducer(state, { type: "endEdit" });
    state = apply(state, prop("headline", "AB"), "prop:home/hero/headline");
    expect(state.past).toHaveLength(2);
  });

  test("history keeps only the last steps: after more edits than the cap, the oldest cannot be undone and memory does not grow", () => {
    expect(HISTORY_LIMIT).toBe(100);
    let state = start();
    for (let index = 0; index < HISTORY_LIMIT + 30; index += 1) state = apply(state, prop("headline", `Step ${index}`));
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    let steps = 0;
    while (state.past.length > 0) {
      state = builderReducer(state, { type: "undo" });
      steps += 1;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(headlineOf(state)).toBe("Step 29");
    expect(isDirty(state)).toBe(true);
    expect(state.future.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    // Redo walks all the way forward again.
    while (state.future.length > 0) state = builderReducer(state, { type: "redo" });
    expect(headlineOf(state)).toBe(`Step ${HISTORY_LIMIT + 29}`);
  });

  test("a refused edit changes nothing and says why, each time", () => {
    const state = start();
    const refused = apply(state, (content) => removePage(content, "home"));
    expect(refused.present).toBe(state.present);
    expect(refused.past).toEqual([]);
    expect(refused.notice).toEqual({ text: PAGE_RULES.home.reason, id: 1 });
    expect(apply(refused, (content) => removePage(content, "home")).notice!.id).toBe(2);
  });

  test("Discard returns to the stored Draft and forgets the history; nothing is left to undo or save", () => {
    let state = apply(apply(start(), prop("headline", "One")), (content) => addPage(content));
    expect(state.page).toBe("page-1");
    state = builderReducer(state, { type: "discard" });
    expect(isDirty(state)).toBe(false);
    expect(state.present).toBe(state.saved);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    // The page that no longer exists is left for one that does.
    expect(state.page).toBe("home");
    expect(state.selection).toEqual({ kind: "page", page: "home" });
  });

  test("Save makes what was sent the stored Draft and starts the history again; edits made while the save ran are kept", () => {
    let state = apply(start(), prop("headline", "Sent"));
    const sent = state.present;
    const stored = clone(sent);
    const unchanged = builderReducer(state, { type: "saved", sent, stored });
    expect(isDirty(unchanged)).toBe(false);
    expect(unchanged.past).toEqual([]);
    expect(headlineOf(unchanged)).toBe("Sent");

    state = apply(state, prop("headline", "Typed while saving"));
    const during = builderReducer(state, { type: "saved", sent, stored });
    expect(headlineOf(during)).toBe("Typed while saving");
    expect(isDirty(during)).toBe(true);
    expect(during.past.length).toBeGreaterThan(0);
    expect(sectionIn(during.saved, "home", "hero")!.props.headline).toBe("Sent");
    // Undo stops at the saved Draft, not before it.
    expect(headlineOf(builderReducer(during, { type: "undo" }))).toBe("Sent");
    expect(isDirty(builderReducer(during, { type: "undo" }))).toBe(false);
  });

  test("the selection always names something that exists: after Undo, Delete and Discard it falls back to the page", () => {
    let state = apply(start(), (content) => addSection(content, "home", "rich_text", "default"));
    expect(state.selection).toEqual({ kind: "section", page: "home", section: "rich_text-1" });
    state = builderReducer(state, { type: "undo" });
    expect(state.selection).toEqual({ kind: "page", page: "home" });

    state = builderReducer(start(), { type: "select", selection: { kind: "section", page: "home", section: "hero" } });
    state = apply(state, (content) => removeSection(content, "home", "hero"));
    expect(state.selection).toEqual({ kind: "section", page: "home", section: "services" });

    state = apply(start(), (content) => addPage(content));
    expect(state.page).toBe("page-1");
    state = apply(state, (content) => removePage(content, "page-1"));
    expect(state.page).toBe("booking");
    expect(state.selection).toEqual({ kind: "page", page: "booking" });
  });

  test("moving between pages and selecting keep the working copy as it is, and an unknown page is ignored", () => {
    let state = apply(start(), prop("headline", "Kept"));
    state = builderReducer(state, { type: "page", page: "about" });
    expect(state).toMatchObject({ page: "about", selection: { kind: "page", page: "about" } });
    expect(headlineOf(state)).toBe("Kept");
    expect(builderReducer(state, { type: "page", page: "nope" })).toBe(state);
    state = builderReducer(state, { type: "select", selection: { kind: "theme" } });
    expect(state.selection).toEqual({ kind: "theme" });
    expect(state.page).toBe("about");
    state = builderReducer(state, { type: "select", selection: { kind: "none" } });
    expect(state.selection).toEqual({ kind: "none" });
    expect(builderReducer(state, { type: "dismissNotice" })).toBe(state);
  });

  test("every kind of edit is one history step the same way: structure, text and theme undo together in order", () => {
    const steps: ((content: SiteContent) => Change)[] = [
      (content) => addPage(content),
      (content) => addSection(content, "page-1", "rich_text", "default"),
      (content) => ({ ok: true, content: setTheme(content, { radius: "large" }) }),
      (content) => moveSection(content, "home", "hero", 1) === content ? { ok: false, error: "x" } : { ok: true, content: moveSection(content, "home", "hero", 1) },
      (content) => duplicatePage(content, "about"),
    ];
    let state = start();
    const seen: SiteContent[] = [state.present];
    for (const step of steps) {
      state = apply(state, step);
      seen.push(state.present);
    }
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      state = builderReducer(state, { type: "undo" } as BuilderAction);
      expect(state.present).toEqual(seen[index]);
    }
    expect(isDirty(state)).toBe(false);
  });
});
