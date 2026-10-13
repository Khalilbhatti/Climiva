"use client";

import Link from "next/link";
import { ArrowLeft, Eye, LayoutTemplate, PanelLeft, PanelRight, Redo2, Rocket, RotateCcw, Save, SquareArrowOutUpRight, Undo2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { findPage, getPrimaryDomain, hasUnpublishedChanges, pagePath } from "@/data/website";
import { cn } from "@/lib/cn";
import { publicSiteHref } from "@/lib/site-domain";
import { previewHref } from "../site-links";
import { PreviewModeSwitch } from "../PreviewModeSwitch";
import { useBuilder } from "./BuilderProvider";

const iconButton =
  "inline-flex size-8 items-center justify-center rounded-btn text-ink-muted transition-colors hover:bg-surface-low hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary-subtle aria-pressed:text-primary";

/** The Builder's top bar: where the website stands, Save / Discard / Publish, and the way to see the Draft and the published site. */
export function BuilderBar() {
  const b = useBuilder();
  const { website, page } = b;
  const published = website.published;
  const savedPage = page ? findPage(website.draft, page.key) : undefined;
  const livePage = page && website.live ? findPage(website.live, page.key) : undefined;
  const nothingToPublish = published && !hasUnpublishedChanges(website);
  const canPublish = !b.readOnly && !b.dirty && !b.stale && !nothingToPublish && !b.publishing;
  const address = getPrimaryDomain(website.site, website.domain);

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link href="/website" aria-label="Back to Website" className="inline-flex items-center gap-1.5 rounded-btn px-1 text-sm font-medium text-ink-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">
          <ArrowLeft aria-hidden className="size-4" />
          Website
        </Link>
        <div className="min-w-0">
          <h1 className="text-sm leading-tight font-bold text-ink">Website Builder</h1>
          <p className="truncate text-xs leading-tight text-ink-muted">{website.site.name}</p>
        </div>
        <span data-testid="builder-status">
          <StatusBadge tone={b.status.tone}>{b.status.label}</StatusBadge>
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!b.readOnly && (
            <>
              <Button variant="tertiary" size="sm" disabled={!b.dirty || b.saving} onClick={() => b.setDiscardOpen(true)}>
                <RotateCcw aria-hidden className="size-3.5" />
                Discard
              </Button>
              <Button size="sm" disabled={!b.dirty || b.saving || b.stale || b.problems.length > 0} onClick={() => void b.save()} title="Save changes (Ctrl+S)">
                <Save aria-hidden className="size-3.5" />
                Save changes
              </Button>
            </>
          )}
          {b.dirty || !savedPage ? (
            <>
              <Button variant="secondary" size="sm" disabled aria-describedby="builder-preview-note">
                <Eye aria-hidden className="size-3.5" />
                Preview
              </Button>
              <span id="builder-preview-note" className="sr-only">
                Save your changes to preview the Draft in its own window.
              </span>
            </>
          ) : (
            <ButtonLink href={previewHref(savedPage.slug)} variant="secondary" size="sm" target="_blank" rel="noopener">
              <Eye aria-hidden className="size-3.5" />
              Preview
            </ButtonLink>
          )}
          {published && (
            <ButtonLink href={publicSiteHref(website.site.platformSlug, livePage ? pagePath(livePage) : "")} variant="secondary" size="sm" target="_blank" rel="noopener">
              View published site
              <SquareArrowOutUpRight aria-hidden className="size-3.5" />
            </ButtonLink>
          )}
          {!b.readOnly && (
            <>
              <Button size="sm" variant={canPublish ? "primary" : "secondary"} disabled={!canPublish} aria-describedby="builder-publish-note" onClick={() => void b.publish()}>
                <Rocket aria-hidden className="size-3.5" />
                {published ? "Publish changes" : "Publish website"}
              </Button>
              <span id="builder-publish-note" className="sr-only">
                {b.dirty ? "Save your changes before publishing." : nothingToPublish ? "There is nothing new to publish." : "Publishes the saved Draft."}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface-low/60 px-4 py-2">
        <div className="flex items-center gap-1" role="group" aria-label="History">
          <button type="button" className={iconButton} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!b.canUndo || b.readOnly} onClick={b.undo}>
            <Undo2 aria-hidden className="size-4" />
          </button>
          <button type="button" className={iconButton} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!b.canRedo || b.readOnly} onClick={b.redo}>
            <Redo2 aria-hidden className="size-4" />
          </button>
        </div>
        <PreviewModeSwitch value={b.mode} onChange={b.setMode} />
        <div className="flex items-center gap-1" role="group" aria-label="Panels">
          <button type="button" className={cn(iconButton, "hidden xl:inline-flex")} aria-pressed={b.panels.pages} aria-label="Pages and sections panel" title="Show or hide the pages and sections panel" onClick={() => b.togglePanel("pages")}>
            <PanelLeft aria-hidden className="size-4" />
          </button>
          <button type="button" className={cn(iconButton, "hidden xl:inline-flex")} aria-pressed={b.panels.inspector} aria-label="Inspector panel" title="Show or hide the inspector panel" onClick={() => b.togglePanel("inspector")}>
            <PanelRight aria-hidden className="size-4" />
          </button>
        </div>
        {/* The Template is a choice about the whole Draft, so it is here, in the bar, and not in a section's inspector. It is on the second row,
            which has the room: the first row's height must not change with what the Draft says, or the panels under it move. It is a link:
            leaving with unsaved changes asks first, like any other link out of the Builder. */}
        <div className="flex items-center gap-1.5" data-testid="builder-template">
          <span className="text-xs text-ink-muted">{website.draft.templateName ? `Based on: ${website.draft.templateName}` : "Custom design"}</span>
          <ButtonLink href="/website/templates" variant="tertiary" size="sm">
            <LayoutTemplate aria-hidden className="size-3.5" />
            {b.readOnly ? "View templates" : "Change template"}
          </ButtonLink>
        </div>
        <p className="ml-auto min-w-0 truncate font-mono text-xs text-ink-muted">
          {address}
          {page ? pagePath(page) : ""}
        </p>
      </div>

      {b.stale && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-warning-line bg-warning-soft px-4 py-2.5 text-sm text-warning">
          <span className="min-w-0 flex-1 font-medium">This website was changed somewhere else after you opened it, so your changes were not saved. Reload to see the latest version.</span>
          <Button size="sm" variant="secondary" onClick={b.reload}>
            Reload latest version
          </Button>
        </div>
      )}
      {b.readOnly && <p className="border-t border-line bg-surface-low px-4 py-2 text-xs text-ink-muted">You can look at this website. Only an owner or admin can change it.</p>}
    </div>
  );
}
