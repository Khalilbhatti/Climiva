"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useBrandStyle } from "@/components/settings/SettingsProvider";
import { DEMO_BUSINESS, DEMO_HOURS, DEMO_SERVICES } from "@/data/template-demo";
import { orderedPages } from "@/data/website";
import { versionOfContent } from "@/lib/site-builder";
import type { SiteContent } from "@/lib/site-template";
import { themeAttributes, themeStyle } from "@/lib/site-theme";
import { PREVIEW_BASE } from "../site-links";
import { SiteFooter, SiteHeader, SiteRenderer } from "../SiteRenderer";
import type { SiteView } from "../site-view";
import { previewMode, type PreviewModeId } from "../preview-modes";

/**
 * A Template drawn by the website's own renderer, from its definition and the demonstration business (data/template-demo), at the width
 * of a real screen and scaled to fit the box it sits in. There is no second implementation of a preview: the same `SiteRenderer`,
 * `SiteHeader` and `SiteFooter` that draw the published site draw this, so what the Gallery shows is what a business would get.
 *
 * It is a picture. The site inside is inert (nothing in it can be clicked, focused or read out; the figure carries a text label instead),
 * it reads nothing from the signed-in business except the workspace's brand accent, which a Template with no accent of its own shows
 * exactly as the Builder's canvas does, and it writes nothing anywhere.
 */

const THUMBNAIL_WIDTH = 1024;

function useBox<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** What the renderer needs to draw a Template: the demonstration business, its hours and Services, and the Template's own pages and theme. */
function useTemplateView(content: SiteContent, version: ReturnType<typeof versionOfContent>): SiteView {
  return useMemo(
    () => ({
      business: DEMO_BUSINESS,
      hours: DEMO_HOURS,
      services: DEMO_SERVICES,
      display: content.settings.serviceDisplay,
      theme: content.theme,
      base: PREVIEW_BASE,
      pages: orderedPages(version)
        .filter((page) => page.visible)
        .map((page) => ({ key: page.key, title: page.title, slug: page.slug, type: page.type })),
      visitor: false,
    }),
    [content, version],
  );
}

function Themed({ content, className, children }: { content: SiteContent; className?: string; children: ReactNode }) {
  const brandStyle = useBrandStyle();
  return (
    <div {...themeAttributes(content.theme)} style={{ ...brandStyle, ...themeStyle(content.theme) } as CSSProperties} className={className}>
      {children}
    </div>
  );
}

/**
 * The top of a Template's home page in a card-sized picture: the header and the first sections, scaled so the whole width of a desktop
 * screen fits. Fixed proportions, so cards line up; what is below the fold is not drawn.
 */
export function TemplateThumbnail({ content, label }: { content: SiteContent; label: string }) {
  const [box, { width }] = useBox<HTMLDivElement>();
  const version = useMemo(() => versionOfContent(content), [content]);
  const view = useTemplateView(content, version);
  const home = version.pages.find((page) => page.type === "home");
  const scale = width > 0 ? width / THUMBNAIL_WIDTH : 1;
  // Only what can show above the fold is drawn, so a card never renders a whole page it will crop.
  const visible = useMemo(() => (home ? { ...home, sections: home.sections.slice(0, 3) } : undefined), [home]);

  return (
    <div ref={box} role="img" aria-label={label} className="relative aspect-[16/11] overflow-hidden border-b border-line bg-surface-low">
      <div
        inert
        style={{ width: THUMBNAIL_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left", visibility: width > 0 ? undefined : "hidden" }}
        className="pointer-events-none absolute top-0 left-0 select-none"
      >
        <Themed content={content} className="@container bg-surface">
          <SiteHeader view={view} />
          {visible && <SiteRenderer page={visible} view={view} embedded />}
        </Themed>
      </div>
    </div>
  );
}

/**
 * One page of a Template in a frame of a chosen preview width (Desktop, Tablet or Mobile, the same widths the Builder uses), scaled down
 * to fit when the area is narrower. The whole page is drawn, header and footer included.
 */
export function TemplateFrame({ content, pageKey, mode, label }: { content: SiteContent; pageKey: string; mode: PreviewModeId; label: string }) {
  const [area, { width: available }] = useBox<HTMLDivElement>();
  const [inner, { height: innerHeight }] = useBox<HTMLDivElement>();
  const version = useMemo(() => versionOfContent(content), [content]);
  const view = useTemplateView(content, version);
  const page = version.pages.find((candidate) => candidate.key === pageKey) ?? version.pages.find((candidate) => candidate.type === "home");
  const { width } = previewMode(mode);
  const scale = available > 0 ? Math.min(1, available / width) : 1;

  return (
    <div ref={area} className="w-full">
      <div
        data-testid="template-frame"
        data-mode={mode}
        data-scale={scale.toFixed(3)}
        role="img"
        aria-label={label}
        className="mx-auto overflow-hidden rounded-card border border-line bg-surface shadow-card"
        style={{ width: width * scale, height: innerHeight > 0 ? innerHeight * scale : undefined, visibility: available > 0 ? undefined : "hidden" }}
      >
        <div ref={inner} inert style={{ width, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" }} className="select-none">
          <Themed content={content} className="@container bg-surface">
            <SiteHeader view={view} />
            {page && <SiteRenderer page={page} view={view} embedded />}
            <SiteFooter view={view} />
          </Themed>
        </div>
      </div>
    </div>
  );
}
