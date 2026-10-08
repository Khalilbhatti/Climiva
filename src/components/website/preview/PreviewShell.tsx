"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import { useBrandStyle } from "@/components/settings/SettingsProvider";
import { ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getPrimaryDomain, WEBSITE_PAGES, type PageId, type SiteContent } from "@/data/website";
import { cn } from "@/lib/cn";
import { editorHref, previewHref } from "../site-links";
import { SiteFooter, SiteHeader } from "../SiteRenderer";
import { useWebsite } from "../WebsiteProvider";

type PreviewValue = {
  /** Following the published site ("View live website") rather than the saved draft ("Preview"). */
  live: boolean;
  content: SiteContent;
};

const PreviewContext = createContext<PreviewValue | null>(null);

export function usePreview(): PreviewValue {
  const context = useContext(PreviewContext);
  if (!context) throw new Error("usePreview must be used inside <PreviewShell>.");
  return context;
}

/** "/website/preview/booking/ac-repair" → "booking" (the page being previewed, for the way back to its editor). */
function pageFromPath(pathname: string): PageId {
  const segment = pathname.replace(/^\/website\/preview\/?/, "").split("/")[0];
  return WEBSITE_PAGES.find((page) => page.id === segment)?.id ?? "home";
}

/**
 * The customer-facing website, outside the workspace shell: no sidebar and no workspace header, only a slim
 * preview toolbar (the one thing that would not exist on the real site) around the site itself.
 */
export function PreviewShell({ children }: { children: ReactNode }) {
  const { site } = useWebsite();
  const brandStyle = useBrandStyle();
  const pathname = usePathname();
  const live = useSearchParams().get("view") === "live";
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const page = pageFromPath(pathname);
  const sitePath = pathname.replace(/^\/website\/preview/, "") || "/";
  const isPrivate = live && !site.published;

  return (
    <PreviewContext value={{ live, content: live ? site.live : site.draft }}>
      <div className="min-h-dvh bg-surface-low">
        <div className="sticky top-0 z-20 border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <Link
              href={live ? "/website" : editorHref(page)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {live ? "Back to Website" : "Back to editor"}
            </Link>
            <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink-muted">
              <span className="truncate font-mono">
                {getPrimaryDomain(site.domain)}
                {sitePath}
              </span>
              <StatusBadge tone={live ? "positive" : "primary"}>{live ? "Live" : "Preview"}</StatusBadge>
            </span>
            <div role="group" aria-label="Preview size" className="flex rounded-btn bg-surface-low p-1">
              {(
                [
                  { id: "desktop", label: "Desktop", icon: Monitor },
                  { id: "mobile", label: "Mobile", icon: Smartphone },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={device === option.id}
                  onClick={() => setDevice(option.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                    device === option.id ? "bg-surface text-primary shadow-card" : "text-ink-muted hover:text-ink",
                  )}
                >
                  <option.icon aria-hidden className="size-3.5" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-6">
          <div
            data-testid="site-frame"
            style={brandStyle}
            className={cn(
              "@container mx-auto overflow-hidden rounded-card border border-line bg-surface shadow-card",
              device === "mobile" ? "max-w-[390px]" : "max-w-5xl",
            )}
          >
            <SiteHeader live={live} />
            {isPrivate ? (
              <section className="px-6 py-14 text-center">
                <h1 className="text-xl font-bold text-ink">This website isn&apos;t published</h1>
                <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
                  The website is private, so visitors can&apos;t open it. Publish it from the Website page, or preview your saved draft.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <ButtonLink href={previewHref(page)}>Preview saved draft</ButtonLink>
                  <ButtonLink href="/website" variant="secondary">
                    Back to Website
                  </ButtonLink>
                </div>
              </section>
            ) : (
              children
            )}
            <SiteFooter />
          </div>
        </div>
      </div>
    </PreviewContext>
  );
}
