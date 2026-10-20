"use client";

import { useRef, useState, type MouseEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { getCustomerById } from "@/data/customers";
import type { IssuedReviewLink, ReviewLinkState, ReviewRequest } from "@/data/reviews";
import { formatDate } from "@/lib/format";
import { IssuedLinkView } from "./ReviewLink";
import { useReviews } from "./ReviewsProvider";

const LINK_LABEL: Record<ReviewLinkState, string> = { none: "No link", active: "Link active", expired: "Link expired", used: "Review received" };
const LINK_TONE: Record<ReviewLinkState, StatusTone> = { none: "neutral", active: "positive", expired: "warning", used: "primary" };

/**
 * The review requests the business has recorded, and where each one's link stands, for the people who may manage reviews. A link is a secret shown once,
 * so a request whose link was lost or ran out is given a NEW link here (the old one stops working). A request the customer already answered has none to give.
 */
export function ReviewRequestsPanel() {
  const dir = useDirectory();
  const { data, reissueLink } = useReviews();
  const { toast } = useToast();
  const [working, setWorking] = useState<string>();
  const [shown, setShown] = useState<{ link: IssuedReviewLink; customerName: string }>();
  const [problem, setProblem] = useState<string>();
  // The button that asked for the new link, so that closing the dialog puts the keyboard back where it was.
  const opener = useRef<HTMLElement | null>(null);

  if (data.requests.length === 0) return null;
  // Newest first, like the reviews above it.
  const requests = [...data.requests].reverse();

  async function renew(request: ReviewRequest, customerName: string, button: HTMLElement) {
    if (working) return;
    opener.current = button;
    setWorking(request.id);
    setProblem(undefined);
    const result = await reissueLink(request.id);
    setWorking(undefined);
    if (!result.ok) return setProblem(result.error);
    if (result.data.link) setShown({ link: result.data.link, customerName });
    else toast("The link could not be shown. Try again.");
  }

  function closeShown() {
    setShown(undefined);
    requestAnimationFrame(() => opener.current?.focus());
  }

  return (
    <>
      <Card padding="md" className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-ink">Review requests</h2>
          <p className="mt-1 text-sm text-ink-muted">Each request has a link you give the customer. A link works once and runs out after a while; make a new one if it is lost.</p>
        </div>
        {problem && (
          <p role="alert" className="rounded-btn border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
            {problem}
          </p>
        )}
        <ul aria-label="Review requests" className="divide-y divide-line">
          {requests.map((request) => {
            const customer = getCustomerById(request.customerId, dir);
            const name = customer?.name ?? "Customer";
            const state: ReviewLinkState = request.link?.state ?? "none";
            return (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  <p className="text-xs text-ink-muted">
                    Asked {formatDate(request.at.slice(0, 10))}
                    {request.relatedJobId ? ` · Job #${request.relatedJobId}` : ""}
                    {state === "active" && request.link?.expires ? ` · Link works until ${formatDate(request.link.expires.slice(0, 10))}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge tone={LINK_TONE[state]}>{LINK_LABEL[state]}</StatusBadge>
                  {state !== "used" && (
                    <Button size="sm" variant="secondary" disabled={working !== undefined} onClick={(event: MouseEvent<HTMLButtonElement>) => void renew(request, name, event.currentTarget)} aria-label={`Get a new review link for ${name}`}>
                      <KeyRound aria-hidden className="size-3.5" />
                      {working === request.id ? "Making…" : "Get a new link"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {shown && (
        <Modal open onClose={closeShown} size="lg" title="New review link" description={`For ${shown.customerName}. The old link no longer works.`} footer={<Button onClick={closeShown}>Done</Button>}>
          <IssuedLinkView link={shown.link} />
        </Modal>
      )}
    </>
  );
}
