"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { STALE_DRAFT } from "@/lib/site-builder-rules";
import { useWebsite, useWebsiteState } from "../WebsiteProvider";

/**
 * Choosing a Template for the website, with the confirmation that makes it deliberate. Nothing happens on a click of a card: `ask(template)`
 * opens a dialog that says what will be replaced and what will not, and only its confirm button sends the request, with the revision of the
 * Draft this tab was looking at. If the stored Draft has moved on (another tab saved), the server refuses and nothing is changed here.
 *
 * On success the Builder opens on the new Draft. It is a different page, so its working copy and Undo history start fresh: applying a
 * Template is a saved replacement of the Draft, not an edit that Undo can take back (the earlier PUBLISHED versions are all kept).
 */
export type TemplateChoice = { key: string; name: string };

export function useTemplateSwitch(): { canChange: boolean; ask: (choice: TemplateChoice) => void; modal: ReactNode } {
  const website = useWebsiteState();
  const { applyTemplate } = useWebsite();
  const canChange = useCan("website:manage");
  const router = useRouter();
  const { toast } = useToast();
  const [choice, setChoice] = useState<TemplateChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setChoice(null);
    setError(null);
  };

  async function confirm() {
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    const result = await applyTemplate(choice.key, website.draft.revision);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(`Draft replaced with ${choice.name}. Your published website has not changed.`);
    setChoice(null);
    router.push("/website/builder");
  }

  const stale = error === STALE_DRAFT;
  const published = website.published;

  const modal = (
    <Modal
      open={choice !== null}
      onClose={close}
      title={choice ? `Replace your draft with ${choice.name}?` : "Replace your draft?"}
      description="This starts your website's draft over from a template."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Keep my draft
          </Button>
          {stale ? (
            <Button onClick={() => window.location.reload()}>Reload latest version</Button>
          ) : (
            <Button variant="destructive-solid" onClick={() => void confirm()} disabled={busy}>
              {busy ? "Replacing…" : choice ? `Replace draft with ${choice.name}` : "Replace draft"}
            </Button>
          )}
        </>
      }
    >
      <ul className="list-disc space-y-2 pl-5 text-sm text-ink">
        <li>
          Your draft&apos;s pages, sections and theme are <strong>replaced</strong>
          {choice ? ` by ${choice.name}` : ""}. Changes you made to them are lost.
        </li>
        <li>
          {published ? (
            <>
              Your <strong>published website does not change</strong>. Visitors keep seeing it until you publish the new draft.
            </>
          ) : (
            <>Your website is not published, so nothing changes for visitors.</>
          )}
        </li>
        <li>Earlier published versions are kept.</li>
        <li>Your business details, hours and Services stay as they are, including which Services your website shows.</li>
      </ul>
      {error && (
        <p role="alert" className="mt-4 rounded-card border border-warning-line bg-warning-soft p-3 text-sm text-warning">
          {error}
        </p>
      )}
    </Modal>
  );

  return { canChange, ask: setChoice, modal };
}
