"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useWebsiteState } from "../WebsiteProvider";
import { BuilderBar } from "./BuilderBar";
import { BuilderCanvas } from "./BuilderCanvas";
import { BuilderProvider, useBuilder } from "./BuilderProvider";
import { Inspector } from "./Inspector";
import { PagesPanel } from "./PagesPanel";
import { SectionLibrary } from "./SectionLibrary";
import { SectionsPanel } from "./SectionsPanel";
import { cn } from "@/lib/cn";

/** The grid at wide widths, by which side panels are open. Below that the regions stack: pages and sections, the page, then the inspector. */
const COLUMNS = {
  both: "xl:grid-cols-[17rem_minmax(0,1fr)_20rem]",
  left: "xl:grid-cols-[17rem_minmax(0,1fr)]",
  right: "xl:grid-cols-[minmax(0,1fr)_20rem]",
  none: "xl:grid-cols-[minmax(0,1fr)]",
} as const;

function BuilderLayout() {
  const b = useBuilder();
  const columns = b.panels.pages ? (b.panels.inspector ? COLUMNS.both : COLUMNS.left) : b.panels.inspector ? COLUMNS.right : COLUMNS.none;

  return (
    <div className="flex flex-col xl:h-[calc(100dvh-var(--topbar-height))]">
      <BuilderBar />
      <div className={cn("grid min-h-0 flex-1 grid-cols-1 gap-4 p-4", columns)}>
        <div className={cn("flex min-h-0 flex-col gap-4 xl:overflow-y-auto", !b.panels.pages && "xl:hidden")}>
          <PagesPanel />
          <SectionsPanel />
        </div>
        <BuilderCanvas />
        <div className={cn("flex min-h-0 flex-col", !b.panels.inspector && "xl:hidden")}>
          <Inspector />
        </div>
      </div>

      <SectionLibrary />
      <Modal
        open={b.discardOpen}
        onClose={() => b.setDiscardOpen(false)}
        title="Discard unsaved changes?"
        description="Everything you changed since the last save is thrown away and the page goes back to the saved Draft. The published website is not affected."
        footer={
          <>
            <Button variant="secondary" onClick={() => b.setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button variant="destructive-solid" onClick={b.discard}>
              Discard changes
            </Button>
          </>
        }
      />
      {b.guard}
    </div>
  );
}

/**
 * The visual Website Builder for the business's website: a bar, a page and section navigator, the page itself, and an inspector. It edits
 * a working copy of the Draft held in the browser and stores it only on Save; the stored Draft, Preview and the published site are the
 * same ones the rest of the workspace uses. Keyed by the Site so a different website never inherits another's unsaved edits.
 */
export function WebsiteBuilder({ initialPage }: { initialPage?: string }) {
  const website = useWebsiteState();
  return (
    <BuilderProvider key={website.site.id} initialPage={initialPage}>
      <BuilderLayout />
    </BuilderProvider>
  );
}
