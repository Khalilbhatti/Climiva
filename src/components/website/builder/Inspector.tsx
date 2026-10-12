"use client";

import { MousePointerClick } from "lucide-react";
import { pageIn, sectionIn } from "@/lib/site-builder";
import { variantLabel } from "@/lib/site-sections";
import { useBuilder } from "./BuilderProvider";
import { PageInspector } from "./PageInspector";
import { SectionInspector } from "./SectionInspector";
import { ThemeInspector } from "./ThemeInspector";

/** The right-hand panel: the Page, Section or Theme inspector for whatever is selected, or a prompt to select something. */
export function Inspector() {
  const b = useBuilder();
  const selection = b.selection;
  const page = selection.kind === "page" || selection.kind === "section" ? pageIn(b.content, selection.page) : undefined;
  const section = selection.kind === "section" ? sectionIn(b.content, selection.page, selection.section) : undefined;

  let title = "Inspector";
  let subtitle = "";
  let body: React.ReactNode = null;
  let id = "none";

  if (selection.kind === "section" && page && section) {
    title = section.label;
    subtitle = `${variantLabel(section.type, section.variant)} section · ${page.title}`;
    body = <SectionInspector key={`${page.key}/${section.key}`} pageKey={page.key} sectionKey={section.key} />;
    id = "section";
  } else if (selection.kind === "page" && page) {
    title = page.title;
    subtitle = "Page";
    body = <PageInspector key={page.key} pageKey={page.key} />;
    id = "page";
  } else if (selection.kind === "theme") {
    title = "Site theme";
    subtitle = "The whole website";
    body = <ThemeInspector />;
    id = "theme";
  }

  return (
    <section aria-labelledby="builder-inspector-heading" data-testid="builder-inspector" data-selection={id} className="flex min-h-0 flex-col rounded-card border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 id="builder-inspector-heading" className="truncate text-sm font-semibold text-ink">
          {title}
        </h2>
        {subtitle && <p className="truncate text-xs text-ink-muted">{subtitle}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {body ?? (
          <div className="flex flex-col items-center py-10 text-center">
            <MousePointerClick aria-hidden className="size-6 text-ink-faint" />
            <p className="mt-2 text-sm font-medium text-ink">Nothing is selected</p>
            <p className="mt-1 text-xs text-ink-muted">Select a section on the page, a page in the list, or Site theme to change it here.</p>
          </div>
        )}
      </div>
    </section>
  );
}
