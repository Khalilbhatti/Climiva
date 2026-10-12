/**
 * The Website Builder's editing core: what a person can do to a Site's Draft, as pure functions over the content shape of lib/site-template
 * (`SiteContent`: theme, settings and the pages with their sections, in order), and the undo history around them.
 *
 * Nothing here knows about React, the database or the screen. The Builder keeps ONE working copy of the Draft (`BuilderState.present`) next
 * to the last stored one (`saved`); every edit is one of these functions applied to the working copy, so a structural change, a text change
 * and a theme change are all the same kind of step in the same history, and Save sends exactly that working copy to the server, which
 * validates it again (`validateContent`) and stores it in one transaction. Persistence stays the Phase 15 model: this file never invents a
 * second one.
 *
 * Identity. A page is its `key`, a section is its `key` within its page. Keys are made here and are deterministic (`page-1`, `hero-2`,
 * `about-copy`), unique where their database constraint needs them to be, and stable: moving, hiding or editing never changes a key, which
 * is how the server matches the working copy to the stored rows and how the screen keeps a selection across a save.
 *
 * Rules. The structural rules (the home page and the booking page cannot be deleted or hidden, the booking page keeps a list of Services,
 * addresses are unique and not reserved, the sizes are bounded) are in lib/site-builder-rules and lib/site-template. The functions here
 * refuse what would break them with a sentence for the person, and the server refuses it again.
 */
import type { VersionModel, ServiceDisplay } from "@/data/website";
import { MAX_PAGES, MAX_SECTIONS_PER_PAGE, validateContent, type ContentPage, type ContentProblem, type ContentSection, type SiteContent } from "./site-template";
import { PAGE_RULES, REQUIRED_SECTION, copyKey, numberedKey, uniqueSlug } from "./site-builder-rules";
import { SECTION_LABEL_MAX, defaultLabelFor, defaultPropsFor, isSectionType, switchVariantProps, type SectionType } from "./site-sections";
import type { SiteTheme } from "./site-theme";

/* ───────────────────────── the stored Draft as content ───────────────────────── */

/** A stored version as editable content: pages and sections in their order, without database identities or order numbers. */
export function contentOf(version: Pick<VersionModel, "theme" | "settings" | "pages">): SiteContent {
  return {
    theme: version.theme,
    settings: { serviceDisplay: { order: [...version.settings.serviceDisplay.order], hidden: [...version.settings.serviceDisplay.hidden] } },
    pages: [...version.pages]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((page) => ({
        key: page.key,
        title: page.title,
        slug: page.slug,
        type: page.type,
        visible: page.visible,
        sections: [...page.sections]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((section) => ({ key: section.key, label: section.label, type: section.type, variant: section.variant, visible: section.visible, props: { ...section.props } })),
      })),
  };
}

/** Working content as a version the renderer can draw: the same shape as a stored one, with the keys as ids and the array order as the order. */
export function versionOfContent(content: SiteContent): VersionModel {
  return {
    id: "builder-draft",
    number: null,
    revision: 0,
    status: "draft",
    templateKey: null,
    theme: content.theme,
    settings: content.settings,
    publishedAt: null,
    pages: content.pages.map((page, pageIndex) => ({
      id: page.key,
      key: page.key,
      title: page.title,
      slug: page.slug,
      type: page.type,
      visible: page.visible,
      sortOrder: pageIndex,
      sections: page.sections.map((section, index) => ({
        id: `${page.key}.${section.key}`,
        key: section.key,
        label: section.label,
        type: section.type,
        variant: section.variant,
        props: section.props,
        visible: section.visible,
        sortOrder: index,
      })),
    })),
  };
}

/** Whether two contents say the same thing (the Builder's "unsaved changes"). */
export const sameContent = (a: SiteContent, b: SiteContent): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/* ───────────────────────── looking things up ───────────────────────── */

export const pageIn = (content: SiteContent, key: string): ContentPage | undefined => content.pages.find((page) => page.key === key);

export const sectionIn = (content: SiteContent, pageKey: string, sectionKey: string): ContentSection | undefined =>
  pageIn(content, pageKey)?.sections.find((section) => section.key === sectionKey);

export const homeOf = (content: SiteContent): ContentPage | undefined => content.pages.find((page) => page.type === "home");

/* ───────────────────────── results ───────────────────────── */

export type BuilderSelection =
  | { kind: "none" }
  | { kind: "theme" }
  | { kind: "page"; page: string }
  | { kind: "section"; page: string; section: string };

/** An edit either produces the next content (and perhaps what to select) or is refused with a sentence. */
export type Change = { ok: true; content: SiteContent; select?: BuilderSelection; notice?: string } | { ok: false; error: string };

const done = (content: SiteContent, select?: BuilderSelection, notice?: string): Change => ({ ok: true, content, select, notice });
const refused = (error: string): Change => ({ ok: false, error });

const withPage = (content: SiteContent, key: string, edit: (page: ContentPage) => ContentPage): SiteContent => ({
  ...content,
  pages: content.pages.map((page) => (page.key === key ? edit(page) : page)),
});

const withSection = (content: SiteContent, pageKey: string, sectionKey: string, edit: (section: ContentSection) => ContentSection): SiteContent =>
  withPage(content, pageKey, (page) => ({ ...page, sections: page.sections.map((section) => (section.key === sectionKey ? edit(section) : section)) }));

const moveWithin = <T>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
};

/* ───────────────────────── what a person may do (and why not) ───────────────────────── */

/** Why a section cannot be removed or hidden, or undefined when it can: its page must keep a visible section of a required type. */
export function sectionLock(content: SiteContent, pageKey: string, sectionKey: string): string | undefined {
  const page = pageIn(content, pageKey);
  const section = page?.sections.find((candidate) => candidate.key === sectionKey);
  if (!page || !section) return undefined;
  const required = REQUIRED_SECTION[page.type];
  if (!required || section.type !== required.type || !section.visible) return undefined;
  const others = page.sections.filter((candidate) => candidate.key !== sectionKey && candidate.type === required.type && candidate.visible);
  return others.length === 0 ? required.message : undefined;
}

/** Why a page cannot be deleted, or undefined when it can. */
export function pageDeleteLock(content: SiteContent, pageKey: string): string | undefined {
  const page = pageIn(content, pageKey);
  if (!page) return undefined;
  return PAGE_RULES[page.type].removable ? undefined : PAGE_RULES[page.type].reason;
}

export function pageHideLock(content: SiteContent, pageKey: string): string | undefined {
  const page = pageIn(content, pageKey);
  if (!page) return undefined;
  return PAGE_RULES[page.type].hideable ? undefined : PAGE_RULES[page.type].reason;
}

export function pageSlugLock(content: SiteContent, pageKey: string): string | undefined {
  const page = pageIn(content, pageKey);
  if (!page) return undefined;
  return PAGE_RULES[page.type].slugEditable ? undefined : PAGE_RULES[page.type].reason;
}

/* ───────────────────────── sections ───────────────────────── */

/** Change one text of a section. The value is stored as typed; an invalid value is reported by `validateContent`, not silently changed. */
export function setSectionProp(content: SiteContent, pageKey: string, sectionKey: string, field: string, value: string): SiteContent {
  const section = sectionIn(content, pageKey, sectionKey);
  if (!section || section.props[field] === value) return content;
  return withSection(content, pageKey, sectionKey, (current) => ({ ...current, props: { ...current.props, [field]: value } }));
}

export function setSectionLabel(content: SiteContent, pageKey: string, sectionKey: string, label: string): SiteContent {
  const section = sectionIn(content, pageKey, sectionKey);
  if (!section || section.label === label) return content;
  return withSection(content, pageKey, sectionKey, (current) => ({ ...current, label: label.slice(0, SECTION_LABEL_MAX) }));
}

export function setSectionVisible(content: SiteContent, pageKey: string, sectionKey: string, visible: boolean): Change {
  const section = sectionIn(content, pageKey, sectionKey);
  if (!section) return refused("That section no longer exists.");
  if (section.visible === visible) return done(content);
  if (!visible) {
    const lock = sectionLock(content, pageKey, sectionKey);
    if (lock) return refused(lock);
  }
  return done(withSection(content, pageKey, sectionKey, (current) => ({ ...current, visible })));
}

/** Move a section to a position on its page (0 is the top). */
export function moveSection(content: SiteContent, pageKey: string, sectionKey: string, to: number): SiteContent {
  const page = pageIn(content, pageKey);
  if (!page) return content;
  const from = page.sections.findIndex((section) => section.key === sectionKey);
  const target = Math.max(0, Math.min(page.sections.length - 1, to));
  if (from === -1 || from === target) return content;
  return withPage(content, pageKey, (current) => ({ ...current, sections: moveWithin(current.sections, from, target) }));
}

export const moveSectionBy = (content: SiteContent, pageKey: string, sectionKey: string, by: -1 | 1): SiteContent => {
  const index = pageIn(content, pageKey)?.sections.findIndex((section) => section.key === sectionKey) ?? -1;
  return index === -1 ? content : moveSection(content, pageKey, sectionKey, index + by);
};

const sectionKeys = (page: ContentPage): Set<string> => new Set(page.sections.map((section) => section.key));

/** A new section of a registered type and variant, with that style's default text, after `afterKey` (or at the end of the page). */
export function addSection(content: SiteContent, pageKey: string, type: SectionType, variant: string, afterKey?: string): Change {
  const page = pageIn(content, pageKey);
  if (!page) return refused("That page no longer exists.");
  if (!isSectionType(type)) return refused("That kind of section is not available.");
  if (page.sections.length >= MAX_SECTIONS_PER_PAGE) return refused(`A page has up to ${MAX_SECTIONS_PER_PAGE} sections.`);
  const key = numberedKey(type, sectionKeys(page), 40);
  const section: ContentSection = { key, label: defaultLabelFor(type, variant), type, variant, visible: true, props: defaultPropsFor(type, variant) };
  const after = afterKey === undefined ? -1 : page.sections.findIndex((candidate) => candidate.key === afterKey);
  const at = after === -1 ? page.sections.length : after + 1;
  const next = withPage(content, pageKey, (current) => ({ ...current, sections: [...current.sections.slice(0, at), section, ...current.sections.slice(at)] }));
  return done(next, { kind: "section", page: pageKey, section: key });
}

/** A copy of a section right after it: the same text, a new key. Editing one never changes the other. */
export function duplicateSection(content: SiteContent, pageKey: string, sectionKey: string): Change {
  const page = pageIn(content, pageKey);
  const index = page?.sections.findIndex((section) => section.key === sectionKey) ?? -1;
  if (!page || index === -1) return refused("That section no longer exists.");
  if (page.sections.length >= MAX_SECTIONS_PER_PAGE) return refused(`A page has up to ${MAX_SECTIONS_PER_PAGE} sections.`);
  const source = page.sections[index];
  const key = copyKey(source.key, sectionKeys(page), 40);
  const copy: ContentSection = { ...source, key, props: { ...source.props } };
  const next = withPage(content, pageKey, (current) => ({ ...current, sections: [...current.sections.slice(0, index + 1), copy, ...current.sections.slice(index + 1)] }));
  return done(next, { kind: "section", page: pageKey, section: key });
}

export function removeSection(content: SiteContent, pageKey: string, sectionKey: string): Change {
  const page = pageIn(content, pageKey);
  const index = page?.sections.findIndex((section) => section.key === sectionKey) ?? -1;
  if (!page || index === -1) return refused("That section no longer exists.");
  const lock = sectionLock(content, pageKey, sectionKey);
  if (lock) return refused(lock);
  const next = withPage(content, pageKey, (current) => ({ ...current, sections: current.sections.filter((section) => section.key !== sectionKey) }));
  // Select the section that took its place, otherwise the one before it, otherwise the page.
  const neighbour = page.sections[index + 1] ?? page.sections[index - 1];
  return done(next, neighbour ? { kind: "section", page: pageKey, section: neighbour.key } : { kind: "page", page: pageKey });
}

/** Switch a section to another style of its type. The text both styles have is kept; the report says what was dropped or added. */
export function changeSectionVariant(content: SiteContent, pageKey: string, sectionKey: string, variant: string): Change & { dropped?: string[] } {
  const section = sectionIn(content, pageKey, sectionKey);
  if (!section) return refused("That section no longer exists.");
  if (section.variant === variant) return done(content);
  const switched = switchVariantProps(section.type, section.variant, variant, section.props);
  const next = withSection(content, pageKey, sectionKey, (current) => ({ ...current, variant, props: switched.props }));
  return { ...done(next), dropped: switched.dropped };
}

/* ───────────────────────── pages ───────────────────────── */

const pageKeys = (content: SiteContent): Set<string> => new Set(content.pages.map((page) => page.key));
const slugsOf = (content: SiteContent, except?: string): Set<string> => new Set(content.pages.filter((page) => page.key !== except).map((page) => page.slug));

/** A new standard page: one page-heading section, an address from its title that no other page has, and a key of its own. */
export function addPage(content: SiteContent, title = "New page"): Change {
  if (content.pages.length >= MAX_PAGES) return refused(`A website has up to ${MAX_PAGES} pages.`);
  const key = numberedKey("page", pageKeys(content), 40);
  const heading = title.trim().slice(0, 80) || "New page";
  const page: ContentPage = {
    key,
    title: heading,
    slug: uniqueSlug(heading, slugsOf(content)),
    type: "content",
    visible: true,
    sections: [
      {
        key: "page_intro-1",
        label: defaultLabelFor("page_intro", "default"),
        type: "page_intro",
        variant: "default",
        visible: true,
        props: { ...defaultPropsFor("page_intro", "default"), heading: heading.slice(0, 80) },
      },
    ],
  };
  return done({ ...content, pages: [...content.pages, page] }, { kind: "page", page: key });
}

/** A copy of a page right after it: a new key, a title and address that are unique, and copies of its sections. It is a standard page. */
export function duplicatePage(content: SiteContent, key: string): Change {
  const index = content.pages.findIndex((page) => page.key === key);
  if (index === -1) return refused("That page no longer exists.");
  if (content.pages.length >= MAX_PAGES) return refused(`A website has up to ${MAX_PAGES} pages.`);
  const source = content.pages[index];
  const copyKeyName = numberedKey("page", pageKeys(content), 40);
  const copy: ContentPage = {
    key: copyKeyName,
    title: `${source.title} (copy)`.slice(0, 80),
    slug: uniqueSlug(`${source.slug === "" ? "home" : source.slug}-copy`, slugsOf(content)),
    type: "content",
    visible: source.visible,
    sections: source.sections.map((section) => ({ ...section, props: { ...section.props } })),
  };
  return done({ ...content, pages: [...content.pages.slice(0, index + 1), copy, ...content.pages.slice(index + 1)] }, { kind: "page", page: copyKeyName });
}

export function removePage(content: SiteContent, key: string): Change {
  const index = content.pages.findIndex((page) => page.key === key);
  if (index === -1) return refused("That page no longer exists.");
  const lock = pageDeleteLock(content, key);
  if (lock) return refused(lock);
  const next = { ...content, pages: content.pages.filter((page) => page.key !== key) };
  const neighbour = content.pages[index - 1] ?? content.pages[index + 1];
  return done(next, neighbour ? { kind: "page", page: neighbour.key } : { kind: "none" });
}

/** The address a person typed, made safe while they type: lower-case, words joined by single hyphens, no leading hyphen. */
export const normalizeSlugInput = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80);

export type PagePatch = { title?: string; slug?: string; visible?: boolean };

export function updatePage(content: SiteContent, key: string, patch: PagePatch): Change {
  const page = pageIn(content, key);
  if (!page) return refused("That page no longer exists.");
  if (patch.slug !== undefined && patch.slug !== page.slug) {
    const lock = pageSlugLock(content, key);
    if (lock) return refused(lock);
  }
  if (patch.visible === false && page.visible) {
    const lock = pageHideLock(content, key);
    if (lock) return refused(lock);
  }
  const next = withPage(content, key, (current) => ({
    ...current,
    title: patch.title ?? current.title,
    slug: patch.slug ?? current.slug,
    visible: patch.visible ?? current.visible,
  }));
  return done(next);
}

/** Move a page to a position in the site's order. The home page stays first and nothing is placed before it. */
export function movePage(content: SiteContent, key: string, to: number): SiteContent {
  const from = content.pages.findIndex((page) => page.key === key);
  if (from === -1 || content.pages[from].type === "home") return content;
  const homeAt = content.pages.findIndex((page) => page.type === "home");
  const target = Math.max(homeAt === -1 ? 0 : homeAt + 1, Math.min(content.pages.length - 1, to));
  if (from === target) return content;
  return { ...content, pages: moveWithin(content.pages, from, target) };
}

export const movePageBy = (content: SiteContent, key: string, by: -1 | 1): SiteContent => {
  const index = content.pages.findIndex((page) => page.key === key);
  return index === -1 ? content : movePage(content, key, index + by);
};

/* ───────────────────────── theme and settings ───────────────────────── */

export function setTheme(content: SiteContent, patch: Partial<SiteTheme>): SiteContent {
  const theme = { ...content.theme, ...patch };
  return JSON.stringify(theme) === JSON.stringify(content.theme) ? content : { ...content, theme };
}

export function setServiceDisplay(content: SiteContent, display: ServiceDisplay): SiteContent {
  const next = { order: [...display.order], hidden: [...display.hidden] };
  return JSON.stringify(next) === JSON.stringify(content.settings.serviceDisplay) ? content : { ...content, settings: { ...content.settings, serviceDisplay: next } };
}

/* ───────────────────────── problems, by where they are ───────────────────────── */

/** What is wrong with the content as it stands, from the same validation the server runs. Empty when it can be saved. */
export function problemsOf(content: SiteContent): ContentProblem[] {
  const result = validateContent(content);
  return result.ok ? [] : result.problems;
}

/** The problems of one section, by field ("" for the section as a whole). */
export function sectionProblems(problems: readonly ContentProblem[], pageKey: string, sectionKey: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const problem of problems) if (problem.page === pageKey && problem.section === sectionKey && out[problem.field ?? ""] === undefined) out[problem.field ?? ""] = problem.message;
  return out;
}

/** The problems of one page itself (its title, address, visibility and what it must contain), by field. */
export function pageProblems(problems: readonly ContentProblem[], pageKey: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const problem of problems) if (problem.page === pageKey && problem.section === undefined && out[problem.field ?? ""] === undefined) out[problem.field ?? ""] = problem.message;
  return out;
}

/** The first problem in words, with where it is, for a message that does not point at a field. */
export const firstProblem = (problems: readonly ContentProblem[]): string | undefined => problems[0]?.message;

/* ───────────────────────── the Builder's state and history ───────────────────────── */

/** How many steps Undo can go back. Older ones are dropped, so a long session never holds unbounded copies. */
export const HISTORY_LIMIT = 100;

export type BuilderState = {
  /** The Draft as last stored: what Discard returns to and what "unsaved" is measured against. */
  saved: SiteContent;
  /** The working copy the canvas shows and Save sends. */
  present: SiteContent;
  past: SiteContent[];
  future: SiteContent[];
  /** The page being edited (its key). */
  page: string;
  selection: BuilderSelection;
  /** Consecutive edits with this key (typing in one field) are one step of history. */
  coalesce: string | null;
  /** The last refusal, for the screen to say; the counter makes the same sentence notable twice. */
  notice: { text: string; id: number } | null;
};

export type BuilderAction =
  | { type: "apply"; change: (content: SiteContent) => Change; coalesce?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; selection: BuilderSelection }
  | { type: "page"; page: string }
  | { type: "endEdit" }
  | { type: "discard" }
  /** A save finished: `sent` is the working copy that was sent, `stored` what the server answered with. */
  | { type: "saved"; sent: SiteContent; stored: SiteContent }
  | { type: "dismissNotice" };

export function initialBuilderState(saved: SiteContent, page?: string): BuilderState {
  const first = page && pageIn(saved, page) ? page : (homeOf(saved)?.key ?? saved.pages[0]?.key ?? "");
  return { saved, present: saved, past: [], future: [], page: first, selection: { kind: "page", page: first }, coalesce: null, notice: null };
}

/** After the content changed (an edit, an Undo), keep the selection on something that still exists. */
function reconcile(state: BuilderState, content: SiteContent): Pick<BuilderState, "page" | "selection"> {
  const page = pageIn(content, state.page) ? state.page : (homeOf(content)?.key ?? content.pages[0]?.key ?? "");
  const selection = state.selection;
  if (selection.kind === "section") {
    if (sectionIn(content, selection.page, selection.section)) return { page: selection.page, selection };
    return { page, selection: { kind: "page", page } };
  }
  if (selection.kind === "page") return pageIn(content, selection.page) ? { page: selection.page, selection } : { page, selection: { kind: "page", page } };
  return { page, selection };
}

function commit(state: BuilderState, next: SiteContent, coalesce: string | undefined): BuilderState {
  if (sameContent(next, state.present)) return state;
  const merge = coalesce !== undefined && state.coalesce === coalesce;
  const past = merge ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT);
  return { ...state, present: next, past, future: [], coalesce: coalesce ?? null };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case "apply": {
      const change = action.change(state.present);
      if (!change.ok) return { ...state, notice: { text: change.error, id: (state.notice?.id ?? 0) + 1 } };
      const selection = change.select ?? state.selection;
      const page = selection.kind === "page" || selection.kind === "section" ? selection.page : state.page;
      const committed = commit({ ...state, selection, page }, change.content, action.coalesce);
      return { ...committed, ...reconcile(committed, committed.present), notice: change.notice ? { text: change.notice, id: (state.notice?.id ?? 0) + 1 } : state.notice };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const present = state.past[state.past.length - 1];
      const next = { ...state, present, past: state.past.slice(0, -1), future: [state.present, ...state.future].slice(0, HISTORY_LIMIT), coalesce: null };
      return { ...next, ...reconcile(next, present) };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const present = state.future[0];
      const next = { ...state, present, past: [...state.past, state.present].slice(-HISTORY_LIMIT), future: state.future.slice(1), coalesce: null };
      return { ...next, ...reconcile(next, present) };
    }
    case "select": {
      const selection = action.selection;
      if (selection.kind === "section" || selection.kind === "page") return { ...state, selection, page: selection.page, coalesce: null };
      return { ...state, selection, coalesce: null };
    }
    case "page": {
      if (!pageIn(state.present, action.page)) return state;
      return { ...state, page: action.page, selection: { kind: "page", page: action.page }, coalesce: null };
    }
    case "endEdit":
      return state.coalesce === null ? state : { ...state, coalesce: null };
    case "discard": {
      const next = { ...state, present: state.saved, past: [], future: [], coalesce: null };
      return { ...next, ...reconcile(next, state.saved) };
    }
    case "saved": {
      // What was stored is the new baseline. If the working copy is still the one that was sent, it becomes the stored one and the history
      // starts again from it; if the person kept editing while the save ran, their edits and history are kept.
      const unchanged = state.present === action.sent || sameContent(state.present, action.sent);
      const next = unchanged ? { ...state, saved: action.stored, present: action.stored, past: [], future: [], coalesce: null } : { ...state, saved: action.stored };
      return { ...next, ...reconcile(next, next.present) };
    }
    case "dismissNotice":
      return state.notice ? { ...state, notice: null } : state;
  }
}

export const isDirty = (state: BuilderState): boolean => !sameContent(state.present, state.saved);
