"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, FilePenLine, Rocket, SquareArrowOutUpRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TabNav } from "@/components/ui/TabNav";
import { hasUnpublishedChanges } from "@/data/website";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { publicSiteHref } from "@/lib/site-domain";
import { previewHref } from "./site-links";
import { SiteStatusBadge, usePublishing } from "./site-ui";
import { useWebsite } from "./WebsiteProvider";

const TABS = [
  { label: "Overview", href: "/website" },
  { label: "Pages & content", href: "/website/pages" },
  { label: "Booking", href: "/website/booking" },
  { label: "Domain", href: "/website/domain" },
] as const;

function Chrome() {
  const { website } = useWebsite();
  const { publishNow, busy } = usePublishing();
  const canManage = useCan("website:manage");
  // A business with no website yet, or ?state=empty (the approved first-time screen), sees the empty state: no tabs, nothing to publish.
  const empty = useSearchParams().get("state") === "empty" || !website;
  const pending = website ? hasUnpublishedChanges(website) : false;
  const published = Boolean(website?.published);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Website</h1>
            {empty ? (
              <StatusBadge tone="neutral">Not published</StatusBadge>
            ) : (
              <>
                <SiteStatusBadge published={published} />
                {published && pending && <StatusBadge tone="warning">Unpublished changes</StatusBadge>}
              </>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">Manage your public website, service pages, booking experience, and domain.</p>
        </div>
        {!empty && website && (
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={previewHref()} variant="secondary">
              <Eye aria-hidden className="size-4" />
              Preview website
            </ButtonLink>
            <ButtonLink href="/website/builder" variant="secondary">
              <FilePenLine aria-hidden className="size-4" />
              Edit website
            </ButtonLink>
            {!published ? (
              canManage && (
                <Button onClick={publishNow} disabled={busy}>
                  <Rocket aria-hidden className="size-4" />
                  Publish website
                </Button>
              )
            ) : (
              <>
                {pending && canManage && (
                  <Button onClick={publishNow} disabled={busy}>
                    <Rocket aria-hidden className="size-4" />
                    Publish changes
                  </Button>
                )}
                <ButtonLink href={publicSiteHref(website.site.platformSlug)} variant={pending && canManage ? "secondary" : "primary"}>
                  View live website
                  <SquareArrowOutUpRight aria-hidden className="size-4" />
                </ButtonLink>
              </>
            )}
          </div>
        )}
      </div>
      {!empty && <TabNav label="Website sections" items={[...TABS]} />}
    </div>
  );
}

/** The Website hub's header, publishing actions and tabs. Shared by Overview, Pages & content, Booking and Domain. */
export function WebsiteChrome() {
  return (
    <Suspense fallback={null}>
      <Chrome />
    </Suspense>
  );
}
