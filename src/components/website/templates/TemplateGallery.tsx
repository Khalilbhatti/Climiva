"use client";

import { Eye, LayoutTemplate } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { AppHref } from "@/config/routes";
import { useWebsiteState } from "../WebsiteProvider";
import { TemplateThumbnail } from "./ScaledSite";
import type { GalleryTemplate } from "./types";
import { useTemplateSwitch } from "./useTemplateSwitch";

/**
 * The Template Gallery: the application's website designs, each drawn by the real renderer so the differences show before anything is
 * opened. Looking changes nothing. A card offers to PREVIEW the Template (a larger view with a page and device switch) or to USE it, which
 * asks for confirmation first because it replaces the Draft; the published website is never touched until the Draft is published.
 */
export function TemplateGallery({ templates }: { templates: readonly GalleryTemplate[] }) {
  const website = useWebsiteState();
  const { canChange, ask, modal } = useTemplateSwitch();
  const currentKey = website.draft.templateKey;
  const currentName = website.draft.templateName;

  return (
    <div className="space-y-6">
      <BackLink href="/website/builder">Back to the Builder</BackLink>
      <PageHeader
        title="Website templates"
        description="Start your website's draft from a different design. Your published website does not change until you publish."
      />

      <p className="flex items-start gap-2 rounded-card bg-surface-low p-4 text-sm text-ink" data-testid="template-current">
        <LayoutTemplate aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          {currentName ? (
            <>
              Your draft is based on <strong>{currentName}</strong>. After you edit it, it may no longer match that template exactly.
            </>
          ) : (
            <>Your draft is not based on one of these templates.</>
          )}{" "}
          {canChange ? "Choosing another template replaces your draft." : "Only an owner or admin can change the template."}
        </span>
      </p>

      <ul className="grid grid-cols-1 gap-6 xl:grid-cols-2" aria-label="Templates">
        {templates.map((template) => {
          const current = template.key === currentKey;
          const previewHref = `/website/templates/${template.key}` as AppHref;
          return (
            <li key={template.key} data-template={template.key} className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
              <TemplateThumbnail content={template.content} label={`Preview picture of the ${template.name} template`} />
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 data-testid="template-name" className="text-base font-bold text-ink">{template.name}</h2>
                  {current && <StatusBadge tone="primary">Current template</StatusBadge>}
                </div>
                <p className="mt-1 text-xs font-semibold text-ink-muted">{[template.style, ...template.tags].join(" · ")}</p>
                <p className="mt-2 text-sm text-ink-muted">{template.description}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  <ButtonLink href={previewHref} variant="secondary" aria-label={`Preview the ${template.name} template`}>
                    <Eye aria-hidden className="size-4" />
                    Preview
                  </ButtonLink>
                  <Button
                    disabled={!canChange}
                    aria-label={`Use the ${template.name} template`}
                    onClick={() => ask({ key: template.key, name: template.name })}
                  >
                    Use this template
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {modal}
    </div>
  );
}
