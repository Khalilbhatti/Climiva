"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { PreviewModeSwitch } from "../PreviewModeSwitch";
import { DEFAULT_PREVIEW_MODE, type PreviewModeId } from "../preview-modes";
import { useWebsiteState } from "../WebsiteProvider";
import { TemplateFrame } from "./ScaledSite";
import type { GalleryTemplate } from "./types";
import { useTemplateSwitch } from "./useTemplateSwitch";

/**
 * A Template in full, before it is applied: each of its pages at Desktop, Tablet or Mobile width, drawn by the real renderer with the
 * demonstration business. Looking writes nothing and changes nothing: the page, the device and the template are local to this screen.
 */
export function TemplatePreview({ template, initialPage }: { template: GalleryTemplate; initialPage?: string }) {
  const website = useWebsiteState();
  const { canChange, ask, modal } = useTemplateSwitch();
  const [mode, setMode] = useState<PreviewModeId>(DEFAULT_PREVIEW_MODE);
  const pages = template.content.pages.filter((page) => page.visible);
  const [pageKey, setPageKey] = useState(pages.find((page) => page.key === initialPage)?.key ?? pages[0]?.key ?? "home");
  const page = pages.find((candidate) => candidate.key === pageKey) ?? pages[0];
  const current = website.draft.templateKey === template.key;

  return (
    <div className="space-y-5">
      <BackLink href="/website/templates">All templates</BackLink>
      <PageHeader
        title={template.name}
        description={template.description}
        actions={
          <>
            {current && <StatusBadge tone="primary">Current template</StatusBadge>}
            <Button disabled={!canChange} aria-label={`Use the ${template.name} template`} onClick={() => ask({ key: template.key, name: template.name })}>
              Use this template
            </Button>
          </>
        }
      />

      <p className="flex items-start gap-2 rounded-card bg-surface-low p-3 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        This preview uses a made-up business and services. Once you use the template, your own business details, hours and Services appear
        in it. {canChange ? "Previewing changes nothing." : "Only an owner or admin can change the template."}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="group" aria-label="Page" className="flex flex-wrap gap-1 rounded-btn bg-surface-low p-1">
          {pages.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              aria-pressed={candidate.key === page?.key}
              onClick={() => setPageKey(candidate.key)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                candidate.key === page?.key ? "bg-surface text-primary shadow-card" : "text-ink-muted hover:text-ink",
              )}
            >
              {candidate.title}
            </button>
          ))}
        </div>
        <PreviewModeSwitch value={mode} onChange={setMode} />
      </div>

      <div className="rounded-card border border-line bg-surface-low p-4">
        <TemplateFrame content={template.content} pageKey={page?.key ?? "home"} mode={mode} label={`${template.name} template, ${page?.title ?? "Home"} page`} />
      </div>
      {modal}
    </div>
  );
}
