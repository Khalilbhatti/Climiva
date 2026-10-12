"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Layers, Plus, Trash2 } from "lucide-react";
import { useBrandStyle } from "@/components/settings/SettingsProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { versionOfContent } from "@/lib/site-builder";
import { variantLabel } from "@/lib/site-sections";
import { themeAttributes, themeStyle } from "@/lib/site-theme";
import { PREVIEW_BASE } from "../site-links";
import { SiteFooter, SiteHeader, SiteSection } from "../SiteRenderer";
import { useSiteView } from "../WebsiteProvider";
import { previewMode } from "../preview-modes";
import { useBuilder } from "./BuilderProvider";
import { useSectionActions } from "./section-actions";

/** The padding around the framed site inside the canvas area, in pixels. */
const GUTTER = 32;

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function useHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

/** The quick actions over the selected section: the same list as its menu, as buttons that stay the size of the rest of the interface. */
function SectionToolbar({ pageKey, sectionKey, scale }: { pageKey: string; sectionKey: string; scale: number }) {
  const actions = useSectionActions(pageKey, sectionKey);
  const icons = { up: ArrowUp, down: ArrowDown, duplicate: Copy, hide: EyeOff, show: Eye, delete: Trash2 } as const;
  return (
    <div
      role="toolbar"
      aria-label="Section actions"
      style={{ top: 8 / scale, right: 8 / scale, transform: `scale(${1 / scale})`, transformOrigin: "top right" }}
      className="absolute z-20 flex items-center gap-0.5 rounded-btn border border-line bg-surface p-0.5 shadow-overlay"
    >
      {actions.map((action) => {
        const Icon = icons[action.id as keyof typeof icons];
        return (
          <button
            key={action.id}
            type="button"
            aria-label={action.label}
            aria-disabled={action.disabled || undefined}
            title={action.disabled ? (action.reason ?? action.label) : action.label}
            onClick={() => {
              if (!action.disabled) action.onSelect();
            }}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-primary",
              action.disabled ? "cursor-not-allowed text-ink-faint" : action.destructive ? "text-danger hover:bg-danger-soft" : "text-ink-muted hover:bg-surface-low hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

/** A themed piece of the framed site: the theme travels with each piece, so the Builder's own selection marks are never drawn in the site's accent. */
function Themed({ children, className }: { children: ReactNode; className?: string }) {
  const b = useBuilder();
  const brandStyle = useBrandStyle();
  return (
    <div inert {...themeAttributes(b.content.theme)} style={{ ...brandStyle, ...themeStyle(b.content.theme) } as CSSProperties} className={cn("@container bg-surface", className)}>
      {children}
    </div>
  );
}

/**
 * The canvas: the selected page of the working Draft, drawn by the very renderer the published site and the Draft preview use, in a frame of
 * the chosen preview width (scaled down to fit when the area is narrower). The site itself is inert, so nothing in it can navigate away, send
 * a message or make a booking; the Builder's own marks (an outline, a name, the actions) sit over it, outside the site's theme.
 */
export function BuilderCanvas() {
  const b = useBuilder();
  const version = useMemo(() => versionOfContent(b.content), [b.content]);
  const view = useSiteView(version, PREVIEW_BASE);
  const mode = previewMode(b.mode);
  const pageModel = version.pages.find((candidate) => candidate.key === b.page?.key);

  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const available = useWidth(scroller);
  const innerHeight = useHeight(inner);
  const scale = available > 0 ? Math.min(1, Math.max(0.3, (available - GUTTER) / mode.width)) : 1;

  const selectedKey = b.selection.kind === "section" && b.selection.page === b.page?.key ? b.selection.section : undefined;

  // Bring the selected section into view when it is chosen from elsewhere (the navigator, the keyboard).
  useEffect(() => {
    const box = scroller.current;
    if (!box || !selectedKey) return;
    const target = box.querySelector<HTMLElement>(`[data-builder-section="${CSS.escape(selectedKey)}"]`);
    if (!target) return;
    const area = box.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (rect.top < area.top + 8) box.scrollTop += rect.top - area.top - 8;
    else if (rect.bottom > area.bottom - 8) box.scrollTop += Math.min(rect.bottom - area.bottom + 8, rect.top - area.top - 8);
  }, [selectedKey]);

  if (!b.page || !pageModel) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-card border border-line bg-surface p-8 text-center">
        <Layers aria-hidden className="size-6 text-ink-faint" />
        <p className="mt-2 text-sm font-medium text-ink">Choose a page to edit</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      {!b.page.visible && (
        <p className="mb-2 rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">This page is hidden. It is not shown on your website or in its menu, but you can still edit it here.</p>
      )}
      <div
        ref={scroller}
        data-testid="builder-canvas"
        className="max-h-[44rem] min-h-96 flex-1 overflow-auto rounded-card border border-line bg-surface-low p-4 xl:max-h-none xl:min-h-0"
        style={{ scrollbarGutter: "stable" }}
      >
        <div data-testid="canvas-frame" data-mode={mode.id} data-scale={scale.toFixed(3)} className="mx-auto overflow-hidden rounded-card border border-line bg-surface shadow-card" style={{ width: mode.width * scale, height: innerHeight > 0 ? innerHeight * scale : undefined }}>
          <div ref={inner} style={{ width: mode.width, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" }}>
            <Themed>
              <SiteHeader view={view} />
            </Themed>
            {pageModel.sections.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <Layers aria-hidden className="size-8 text-ink-faint" />
                <p className="mt-3 text-base font-semibold text-ink">This page is empty</p>
                <p className="mt-1 text-sm text-ink-muted">{b.readOnly ? "An owner or admin can add sections." : "Add a section to start building it."}</p>
                {!b.readOnly && (
                  <Button className="mt-4" onClick={() => b.setLibraryOpen(true)} style={{ transform: `scale(${1 / scale})` }}>
                    <Plus aria-hidden className="size-4" />
                    Add section
                  </Button>
                )}
              </div>
            ) : (
              pageModel.sections.map((section) => {
                const selected = selectedKey === section.key;
                return (
                  <div key={section.key} data-builder-section={section.key} data-selected={selected || undefined} className="group relative">
                    {section.visible ? (
                      <Themed>
                        <SiteSection section={section} view={view} embedded primary={false} />
                      </Themed>
                    ) : (
                      <div className="flex items-center gap-2 border-y border-dashed border-line-strong bg-surface-low px-5 py-3 text-sm text-ink-muted">
                        <EyeOff aria-hidden className="size-4" />
                        <span>
                          Hidden · {section.label} <span className="opacity-80">({variantLabel(section.type, section.variant)})</span>
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => b.select({ kind: "section", page: pageModel.key, section: section.key })}
                      aria-label={`Select ${section.label} section`}
                      aria-pressed={selected}
                      style={selected ? { boxShadow: `inset 0 0 0 ${2 / scale}px var(--color-primary), inset 0 0 0 ${4 / scale}px #fff` } : undefined}
                      className={cn("absolute inset-0 z-10 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary", !selected && "hover:bg-primary/5")}
                    />
                    <span
                      aria-hidden
                      style={{ top: 8 / scale, left: 8 / scale, transform: `scale(${1 / scale})`, transformOrigin: "top left" }}
                      className={cn("pointer-events-none absolute z-20 max-w-60 truncate rounded bg-primary px-2 py-0.5 text-xs font-semibold text-white", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    >
                      {section.label}
                    </span>
                    {selected && !b.readOnly && <SectionToolbar pageKey={pageModel.key} sectionKey={section.key} scale={scale} />}
                  </div>
                );
              })
            )}
            <Themed>
              <SiteFooter view={view} />
            </Themed>
          </div>
        </div>
      </div>
    </div>
  );
}
