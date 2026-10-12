"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Home, Palette, Plus, Trash2 } from "lucide-react";
import { ActionMenu, type MenuAction } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { pagePath } from "@/data/website";
import { cn } from "@/lib/cn";
import { pageDeleteLock, pageHideLock } from "@/lib/site-builder";
import { MAX_PAGES, type ContentPage } from "@/lib/site-template";
import { useBuilder } from "./BuilderProvider";

const OFF = "Only an owner or admin can change the website.";

/** The page navigator: every page of the Draft in site order, the page being edited marked, and what can be done to each. */
export function PagesPanel() {
  const b = useBuilder();
  const [deleting, setDeleting] = useState<ContentPage | null>(null);
  const pages = b.content.pages;
  const themeSelected = b.selection.kind === "theme";

  function actionsFor(page: ContentPage, index: number): MenuAction[] {
    const hideLock = pageHideLock(b.content, page.key);
    const deleteLock = pageDeleteLock(b.content, page.key);
    const home = page.type === "home";
    const full = pages.length >= MAX_PAGES;
    return [
      { id: "up", label: "Move up", icon: ArrowUp, disabled: b.readOnly || home || index <= 1, reason: b.readOnly ? OFF : home ? "The home page stays first." : "It is already the first page after Home.", onSelect: () => b.movePageBy(page.key, -1) },
      { id: "down", label: "Move down", icon: ArrowDown, disabled: b.readOnly || home || index === pages.length - 1, reason: b.readOnly ? OFF : home ? "The home page stays first." : "It is already the last page.", onSelect: () => b.movePageBy(page.key, 1) },
      { id: "duplicate", label: "Duplicate page", icon: Copy, disabled: b.readOnly || full, reason: b.readOnly ? OFF : `A website has up to ${MAX_PAGES} pages.`, onSelect: () => b.duplicatePage(page.key) },
      page.visible
        ? { id: "hide", label: "Hide page", icon: EyeOff, disabled: b.readOnly || Boolean(hideLock), reason: b.readOnly ? OFF : hideLock, onSelect: () => b.updatePage(page.key, { visible: false }) }
        : { id: "show", label: "Show page", icon: Eye, disabled: b.readOnly, reason: OFF, onSelect: () => b.updatePage(page.key, { visible: true }) },
      { id: "delete", label: "Delete page", icon: Trash2, destructive: true, disabled: b.readOnly || Boolean(deleteLock), reason: b.readOnly ? OFF : deleteLock, onSelect: () => setDeleting(page) },
    ];
  }

  return (
    <section aria-labelledby="builder-pages-heading" className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 id="builder-pages-heading" className="text-sm font-semibold text-ink">
            Pages
          </h2>
          <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">{pages.length}</span>
        </div>
        {!b.readOnly && (
          <Button size="sm" variant="secondary" onClick={b.addPage} disabled={pages.length >= MAX_PAGES} aria-label="Add page" title={pages.length >= MAX_PAGES ? `A website has up to ${MAX_PAGES} pages.` : "Add a page"}>
            <Plus aria-hidden className="size-3.5" />
            Page
          </Button>
        )}
      </div>

      <ul className="p-2">
        {pages.map((page, index) => {
          const current = page.key === b.page?.key;
          const pageSelected = current && b.selection.kind === "page";
          return (
            <li key={page.key} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => b.select({ kind: "page", page: page.key })}
                aria-current={current ? "page" : undefined}
                data-testid={`builder-page-${page.key}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-btn px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                  current ? "bg-primary-subtle" : "hover:bg-surface-low",
                  pageSelected && "ring-1 ring-primary ring-inset",
                )}
              >
                {page.type === "home" ? <Home aria-hidden className="size-4 shrink-0 text-primary" /> : <span aria-hidden className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{page.title}</span>
                  <span className="block truncate font-mono text-xs text-ink-muted">{pagePath(page)}</span>
                </span>
                {!page.visible && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">
                    <EyeOff aria-hidden className="size-3" />
                    Hidden
                  </span>
                )}
              </button>
              <ActionMenu label={`Actions for ${page.title} page`} actions={actionsFor(page, index)} />
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={() => b.select({ kind: "theme" })}
          aria-pressed={themeSelected}
          className={cn(
            "flex w-full items-center gap-2 rounded-btn px-2.5 py-2 text-left text-sm font-medium text-ink transition-colors focus-visible:outline-2 focus-visible:outline-primary",
            themeSelected ? "bg-primary-subtle ring-1 ring-primary ring-inset" : "hover:bg-surface-low",
          )}
        >
          <Palette aria-hidden className="size-4 shrink-0 text-primary" />
          Site theme
        </button>
      </div>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete the ${deleting?.title ?? ""} page?`}
        description="The page and its sections are removed from the Draft. The published website keeps the page until you publish, and Undo brings it back before you save."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              onClick={() => {
                if (deleting) b.removePage(deleting.key);
                setDeleting(null);
              }}
            >
              Delete page
            </Button>
          </>
        }
      />
    </section>
  );
}
