"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { formatDate } from "@/lib/format";
import { useMarketplace } from "./MarketplaceProvider";

const NOTE_MAX = 500;

/**
 * Told to a business whose Marketplace listing the platform has suspended. It says THAT, what it means and whatever Climvia chose to tell this business
 * (a message written for the business; the internal reason the platform recorded is never shown here and is not even sent to this page). What the
 * business entered stays saved; it can still edit it. Publishing again does not make the listing public while the suspension stands, and when it is lifted
 * the listing is public again only if the business has it published.
 *
 * An owner or admin may ask Climvia to look at the suspension again. That records the request and the note and changes nothing about whether the listing
 * is public; only Climvia lifts a suspension. One request waits at a time, so the form gives way to its status.
 */
export function SuspendedNotice({ published }: { published: boolean }) {
  const { listing, requestReview } = useMarketplace();
  const canManage = useCan("marketplace:manage");
  const { toast } = useToast();
  const suspension = listing.suspension;
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();

  const review = suspension?.review;
  const waiting = review?.state === "requested";

  async function ask() {
    if (pending) return;
    setProblem(undefined);
    setFieldError(undefined);
    setPending(true);
    const result = await requestReview(note);
    setPending(false);
    if (!result.ok) {
      if (result.fields?.note) setFieldError(result.fields.note);
      else setProblem(result.error);
      return;
    }
    setNote("");
    toast("Climvia has your request. The answer will appear here.");
  }

  return (
    <section aria-labelledby="suspended-heading" role="status" className="flex items-start gap-3 rounded-card border border-danger-line bg-danger-soft p-4 text-danger">
      <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h2 id="suspended-heading" className="text-sm font-semibold">
            Climvia has suspended your Marketplace listing
          </h2>
          <p className="mt-1 text-sm">
            Customers can&apos;t find your listing, open it or book from it while it is suspended. Your listing content is saved
            {published ? " and it is still set to published, so it will be visible again when Climvia lifts the suspension." : ". Publishing it will not make it public until Climvia lifts the suspension."}
          </p>
          {suspension?.suspendedAt && <p className="mt-1 text-xs">Suspended on {formatDate(suspension.suspendedAt.slice(0, 10))}.</p>}
        </div>

        {suspension?.message && (
          <div className="rounded-btn border border-danger-line bg-surface p-3 text-ink">
            <p className="text-xs font-semibold text-danger">Message from Climvia</p>
            <p className="mt-1 text-sm whitespace-pre-line">{suspension.message}</p>
          </div>
        )}

        {review && waiting && (
          <div className="rounded-btn border border-warning-line bg-warning-soft p-3 text-warning">
            <p className="text-sm font-semibold">You asked Climvia to review this suspension</p>
            <p className="mt-1 text-xs">
              Asked {review.requestedAt ? formatDate(review.requestedAt.slice(0, 10)) : "recently"}. The listing stays suspended while Climvia looks. The answer will appear here.
            </p>
            {review.note && <p className="mt-2 text-xs whitespace-pre-line text-ink">Your note: {review.note}</p>}
          </div>
        )}

        {review && review.state === "resolved" && review.outcome === "kept" && (
          <div className="rounded-btn border border-line bg-surface p-3 text-ink">
            <p className="text-sm font-semibold">Climvia reviewed your request and the suspension stays</p>
            <p className="mt-1 text-xs text-ink-muted">
              Answered {review.resolvedAt ? formatDate(review.resolvedAt.slice(0, 10)) : "recently"}. The message above is what Climvia asks of you. You can ask again a day after an answer.
            </p>
          </div>
        )}

        {!waiting &&
          (canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
              className="space-y-3 text-ink"
            >
              <Textarea
                label="Ask Climvia to review this suspension (optional note)"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                error={fieldError}
                hint="Say what has changed or what Climvia should know. Asking does not lift the suspension; only Climvia can do that."
                onChange={(event) => setNote(event.target.value)}
              />
              {problem && <FormAlert>{problem}</FormAlert>}
              <Button type="submit" variant="secondary" disabled={pending}>
                {pending ? "Sending…" : "Ask Climvia to review"}
              </Button>
            </form>
          ) : (
            <p className="text-xs">An owner or admin of your workspace can ask Climvia to review this suspension.</p>
          ))}
      </div>
    </section>
  );
}
