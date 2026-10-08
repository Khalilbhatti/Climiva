"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, FilePenLine, Rocket, SquareArrowOutUpRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TabNav } from "@/components/ui/TabNav";
import { hasUnpublishedChanges } from "@/data/website";
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
  const { site } = useWebsite();
  const { publishNow } = usePublishing();
  const empty = useSearchParams().get("state") === "empty";
  const pending = hasUnpublishedChanges(site);

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
                <SiteStatusBadge published={site.published} />
                {site.published && pending && <StatusBadge tone="warning">Unpublished changes</StatusBadge>}
              </>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">Manage your public website, service pages, booking experience, and domain.</p>
        </div>
        {!empty && (
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={previewHref("home")} variant="secondary">
              <Eye aria-hidden className="size-4" />
              Preview website
            </ButtonLink>
            <ButtonLink href="/website/pages" variant="secondary">
              <FilePenLine aria-hidden className="size-4" />
              Edit website
            </ButtonLink>
            {!site.published ? (
              <Button onClick={publishNow}>
                <Rocket aria-hidden className="size-4" />
                Publish website
              </Button>
            ) : (
              <>
                {pending && (
                  <Button onClick={publishNow}>
                    <Rocket aria-hidden className="size-4" />
                    Publish changes
                  </Button>
                )}
                <ButtonLink href={previewHref("home", true)} variant={pending ? "secondary" : "primary"}>
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
