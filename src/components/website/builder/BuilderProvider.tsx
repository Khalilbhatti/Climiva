"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { hasUnpublishedChanges, type ServiceDisplay, type WebsiteState } from "@/data/website";
import {
  addPage,
  addSection,
  builderReducer,
  changeSectionVariant,
  contentOf,
  duplicatePage,
  duplicateSection,
  initialBuilderState,
  isDirty,
  movePageBy,
  moveSection,
  moveSectionBy,
  pageIn,
  problemsOf,
  removePage,
  removeSection,
  sectionIn,
  setSectionLabel,
  setSectionProp,
  setSectionVisible,
  setServiceDisplay,
  setTheme,
  updatePage,
  type BuilderSelection,
  type Change,
  type PagePatch,
} from "@/lib/site-builder";
import { STALE_DRAFT } from "@/lib/site-builder-rules";
import type { SectionType } from "@/lib/site-sections";
import type { ContentPage, ContentProblem, SiteContent } from "@/lib/site-template";
import type { SiteTheme } from "@/lib/site-theme";
import { DEFAULT_PREVIEW_MODE, type PreviewModeId } from "../preview-modes";
import { useWebsite, useWebsiteState } from "../WebsiteProvider";

/**
 * The Website Builder's working state, in one place: the working copy of the Draft with its undo history (lib/site-builder), what is
 * selected, the preview size, which panels are open, and the three things that touch the server: Save, Discard and Publish.
 *
 * The working copy is TEMPORARY editing state. The stored Draft is authoritative: Save sends the whole working copy with the revision it
 * was opened at, the server validates and stores it and answers with the Draft as stored, and only then does the working copy become the
 * new baseline (a Draft that has moved on elsewhere is refused, and nothing is overwritten). Nothing is persisted on a keystroke.
 */

type Panels = { pages: boolean; inspector: boolean };

export type BuilderApi = {
  website: WebsiteState;
  /** Whether this person may only look: every control that changes the Draft is off, and the server would refuse it anyway. */
  readOnly: boolean;

  content: SiteContent;
  page: ContentPage | undefined;
  selection: BuilderSelection;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  /** The stored Draft moved on after this copy was opened: nothing can be saved or published from here until the page is reloaded. */
  stale: boolean;
  problems: readonly ContentProblem[];
  /** What the server said was wrong with the last save, keyed "page", "page.section" or "page.section.field". */
  serverFields: Readonly<Record<string, string>>;
  /** "Draft saved", "Published", "Draft newer than published" ... : where the website stands. */
  status: { label: string; tone: "neutral" | "positive" | "warning" | "primary" };
  canUndo: boolean;
  canRedo: boolean;
  /** Steps back / forward that exist (for the history cap's test and the buttons' hints). */
  historyDepth: { past: number; future: number };

  mode: PreviewModeId;
  setMode: (mode: PreviewModeId) => void;
  panels: Panels;
  togglePanel: (panel: keyof Panels) => void;
  libraryOpen: boolean;
  setLibraryOpen: (open: boolean) => void;
  discardOpen: boolean;
  setDiscardOpen: (open: boolean) => void;

  select: (selection: BuilderSelection) => void;
  selectPage: (pageKey: string) => void;

  setProp: (pageKey: string, sectionKey: string, field: string, value: string) => void;
  setLabel: (pageKey: string, sectionKey: string, label: string) => void;
  setVisible: (pageKey: string, sectionKey: string, visible: boolean) => void;
  moveSectionTo: (pageKey: string, sectionKey: string, to: number) => void;
  moveSectionBy: (pageKey: string, sectionKey: string, by: -1 | 1) => void;
  addSection: (type: SectionType, variant: string) => void;
  duplicateSection: (pageKey: string, sectionKey: string) => void;
  removeSection: (pageKey: string, sectionKey: string) => void;
  changeVariant: (pageKey: string, sectionKey: string, variant: string) => void;

  addPage: () => void;
  duplicatePage: (pageKey: string) => void;
  removePage: (pageKey: string) => void;
  updatePage: (pageKey: string, patch: PagePatch, coalesce?: string) => void;
  movePageBy: (pageKey: string, by: -1 | 1) => void;

  setTheme: (patch: Partial<SiteTheme>, coalesce?: string) => void;
  setServiceDisplay: (display: ServiceDisplay) => void;

  endEdit: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
  discard: () => void;
  publish: () => Promise<boolean>;

  /** The dialog that asks before leaving with unsaved changes: render it once. */
  guard: ReactNode;
  /** Follow a link out of the Builder, asking first when something is unsaved. */
  leave: (href: string) => void;
  /** Load the page again (the latest stored Draft), without the browser's own prompt: the person chose to give up what is on screen. */
  reload: () => void;
};

const BuilderContext = createContext<BuilderApi | null>(null);

export function useBuilder(): BuilderApi {
  const context = useContext(BuilderContext);
  if (!context) throw new Error("useBuilder must be used inside <BuilderProvider>.");
  return context;
}

const ok = (content: SiteContent, select?: BuilderSelection, notice?: string): Change => ({ ok: true, content, select, notice });

const isEditable = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
};

export function BuilderProvider({ initialPage, children }: { initialPage?: string; children: ReactNode }) {
  const website = useWebsiteState();
  const { saveDraft, publish: publishDraft } = useWebsite();
  const canManage = useCan("website:manage");
  const { toast } = useToast();

  const [state, step] = useReducer(builderReducer, undefined, () => initialBuilderState(contentOf(website.draft), initialPage));
  const [revision, setRevision] = useState(website.draft.revision);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [stale, setStale] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<PreviewModeId>(DEFAULT_PREVIEW_MODE);
  const [panels, setPanels] = useState<Panels>({ pages: true, inspector: true });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const readOnly = !canManage;
  const dirty = isDirty(state);
  const problems = useMemo(() => problemsOf(state.present), [state.present]);
  const page = pageIn(state.present, state.page);

  const { guard, leave } = useUnsavedGuard(dirty, "your changes to this website");

  // The address bar follows the page being edited (the native History API is wired into Next's router: no request is made).
  useEffect(() => {
    if (!state.page) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("page") === state.page) return;
    url.searchParams.set("page", state.page);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [state.page]);

  // A refused edit says why.
  const lastNotice = useRef(0);
  useEffect(() => {
    const notice = state.notice;
    if (notice && notice.id !== lastNotice.current) {
      lastNotice.current = notice.id;
      toast(notice.text);
    }
  }, [state.notice, toast]);

  // Closing or reloading the tab with unsaved changes uses the browser's own prompt (unless the person chose Reload latest version).
  const reloading = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const before = (event: BeforeUnloadEvent) => {
      if (reloading.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);

  const apply = useCallback((change: (content: SiteContent) => Change, coalesce?: string) => {
    if (!canManage) return;
    step({ type: "apply", change, coalesce });
  }, [canManage]);

  const undo = useCallback(() => step({ type: "undo" }), []);
  const redo = useCallback(() => step({ type: "redo" }), []);

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly || saving || !dirty || stale || problems.length > 0) return false;
    setSaving(true);
    setServerFields({});
    const sent = state.present;
    const result = await saveDraft(sent, revision);
    setSaving(false);
    if (!result.ok) {
      if (result.error === STALE_DRAFT) setStale(true);
      setServerFields(result.fields ?? {});
      toast(result.error);
      return false;
    }
    const stored = result.data.website;
    if (!stored) {
      toast("The website could not be loaded after saving. Reload the page.");
      return false;
    }
    setRevision(stored.draft.revision);
    step({ type: "saved", sent, stored: contentOf(stored.draft) });
    toast("Draft saved.");
    return true;
  }, [readOnly, saving, dirty, stale, problems.length, state.present, saveDraft, revision, toast]);

  const publish = useCallback(async (): Promise<boolean> => {
    // The Builder publishes what it is showing, saved: never a different state than the one on screen.
    if (readOnly || publishing || dirty || stale) return false;
    setPublishing(true);
    const result = await publishDraft(revision);
    setPublishing(false);
    if (!result.ok) {
      if (result.error === STALE_DRAFT) setStale(true);
      toast(result.error);
      return false;
    }
    toast("Website published.");
    return true;
  }, [readOnly, publishing, dirty, stale, publishDraft, revision, toast]);

  const discard = useCallback(() => {
    step({ type: "discard" });
    setServerFields({});
    setDiscardOpen(false);
    toast("Unsaved changes discarded.");
  }, [toast]);

  // Keyboard: Save works anywhere; Undo and Redo leave a text field's own undo alone. Publish has no shortcut on purpose.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (isEditable(event.target)) return;
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo]);

  const status = useMemo<BuilderApi["status"]>(() => {
    if (saving) return { label: "Saving…", tone: "primary" };
    if (dirty) return { label: "Unsaved changes", tone: "warning" };
    if (!website.published) return { label: "Draft saved", tone: "neutral" };
    return hasUnpublishedChanges(website) ? { label: "Draft newer than published", tone: "warning" } : { label: "Published", tone: "positive" };
  }, [saving, dirty, website]);

  const api = useMemo<BuilderApi>(() => {
    const pageKey = state.page;
    const selectedSection = state.selection.kind === "section" && state.selection.page === pageKey ? state.selection.section : undefined;
    return {
      website,
      readOnly,
      content: state.present,
      page,
      selection: state.selection,
      dirty,
      saving,
      publishing,
      stale,
      problems,
      serverFields,
      status,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      historyDepth: { past: state.past.length, future: state.future.length },

      mode,
      setMode,
      panels,
      togglePanel: (panel) => setPanels((current) => ({ ...current, [panel]: !current[panel] })),
      libraryOpen,
      setLibraryOpen,
      discardOpen,
      setDiscardOpen,

      select: (selection) => step({ type: "select", selection }),
      selectPage: (key) => step({ type: "page", page: key }),

      setProp: (page, section, field, value) => apply((content) => ok(setSectionProp(content, page, section, field, value)), `prop:${page}/${section}/${field}`),
      setLabel: (page, section, label) => apply((content) => ok(setSectionLabel(content, page, section, label)), `label:${page}/${section}`),
      setVisible: (page, section, visible) => apply((content) => setSectionVisible(content, page, section, visible)),
      moveSectionTo: (page, section, to) => apply((content) => ok(moveSection(content, page, section, to))),
      moveSectionBy: (page, section, by) => apply((content) => ok(moveSectionBy(content, page, section, by))),
      addSection: (type, variant) => apply((content) => addSection(content, pageKey, type, variant, selectedSection)),
      duplicateSection: (page, section) => apply((content) => duplicateSection(content, page, section)),
      removeSection: (page, section) =>
        apply((content) => {
          const label = sectionIn(content, page, section)?.label ?? "Section";
          const result = removeSection(content, page, section);
          return result.ok ? { ...result, notice: `${label} section removed. Undo brings it back.` } : result;
        }),
      changeVariant: (page, section, variant) => apply((content) => changeSectionVariant(content, page, section, variant)),

      addPage: () => apply((content) => addPage(content)),
      duplicatePage: (key) => apply((content) => duplicatePage(content, key)),
      removePage: (key) =>
        apply((content) => {
          const title = pageIn(content, key)?.title ?? "Page";
          const result = removePage(content, key);
          return result.ok ? { ...result, notice: `${title} page removed. Undo brings it back.` } : result;
        }),
      updatePage: (key, patch, coalesce) => apply((content) => updatePage(content, key, patch), coalesce),
      movePageBy: (key, by) => apply((content) => ok(movePageBy(content, key, by))),

      setTheme: (patch, coalesce) => apply((content) => ok(setTheme(content, patch), { kind: "theme" }), coalesce),
      setServiceDisplay: (display) => apply((content) => ok(setServiceDisplay(content, display)), "service-display"),

      endEdit: () => step({ type: "endEdit" }),
      undo,
      redo,
      save,
      discard,
      publish,
      guard,
      leave,
      reload: () => {
        reloading.current = true;
        window.location.reload();
      },
    };
  }, [website, readOnly, state, page, dirty, saving, publishing, stale, problems, serverFields, status, mode, panels, libraryOpen, discardOpen, apply, undo, redo, save, discard, publish, guard, leave]);

  return <BuilderContext value={api}>{children}</BuilderContext>;
}
