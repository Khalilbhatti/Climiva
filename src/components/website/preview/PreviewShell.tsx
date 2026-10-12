"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import { useBrandStyle } from "@/components/settings/SettingsProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getPrimaryDomain, orderedPages } from "@/data/website";
import { cn } from "@/lib/cn";
import { accentStyle } from "@/lib/site-theme";
import { editorHref, PREVIEW_BASE } from "../site-links";
import { SiteFooter, SiteHeader } from "../SiteRenderer";
import { useSiteView, useWebsiteState } from "../WebsiteProvider";

/**
 * The customer-facing website, outside the workspace shell: no sidebar and no workspace header, only a slim preview toolbar (the one
 * thing that would not exist on the real site) around the site itself. It shows the saved DRAFT, to people signed in to the business:
 * what visitors see is the published site, a different route.
 */
export function PreviewShell({ children }: { children: ReactNode }) {
  const website = useWebsiteState();
  const brandStyle = useBrandStyle();
  const pathname = usePathname();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const view = useSiteView(website.draft, PREVIEW_BASE);

  const sitePath = pathname.replace(/^\/website\/preview/, "") || "/";
  const segment = sitePath.replace(/^\//, "").split("/")[0];
  const pages = orderedPages(website.draft);
  // The page being previewed, for the way back to its editor.
  const page = pages.find((candidate) => candidate.slug === segment) ?? pages.find((candidate) => candidate.type === "home");

  return (
    <div className="min-h-dvh bg-surface-low">
      <div className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <Link href={page ? editorHref(page.key) : "/website"} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary">
            <ArrowLeft aria-hidden className="size-4" />
            Back to editor
          </Link>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink-muted">
            <span className="truncate font-mono">
              {getPrimaryDomain(website.site, website.domain)}
              {sitePath}
            </span>
            <StatusBadge tone="primary">Preview</StatusBadge>
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
          style={{ ...brandStyle, ...accentStyle(website.draft.theme) }}
          className={cn("@container mx-auto overflow-hidden rounded-card border border-line bg-surface shadow-card", device === "mobile" ? "max-w-[390px]" : "max-w-5xl")}
        >
          <SiteHeader view={view} />
          {children}
          <SiteFooter view={view} />
        </div>
      </div>
    </div>
  );
}
