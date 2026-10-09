"use client";

import { useState } from "react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { RESPONSE_MAX, type Review } from "@/data/reviews";
import { formatDate } from "@/lib/format";
import { useReviews } from "./ReviewsProvider";
import { Stars, reviewerName } from "./review-ui";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

type ReplyModalProps = {
  review: Review;
  /** reply: post the review's first response. edit: change the response it already has. */
  mode: "reply" | "edit";
  onClose: () => void;
  onDone?: () => void;
};

/** Reply to a review, or edit the reply. Either way the review has one response. */
export function ReplyModal({ review, mode, onClose, onDone }: ReplyModalProps) {
  const dir = useDirectory();
  const { postResponse, editResponse } = useReviews();
  const { toast } = useToast();
  const name = reviewerName(review, dir);
  const [body, setBody] = useState(mode === "edit" ? (review.response?.body ?? "") : (review.replyDraft ?? ""));
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const error = body.trim() === "" ? "Write a response before posting." : undefined;

  async function submit() {
    if (saving) return;
    if (error) return setShowError(true);
    setSaving(true);
    setProblem(undefined);
    const result = await (mode === "edit" ? editResponse(review.id, body) : postResponse(review.id, body));
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    toast(mode === "edit" ? "Response updated." : "Response posted.");
    onDone?.();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={mode === "edit" ? "Edit response" : "Reply to review"}
      description={mode === "edit" ? `Update your public response to ${name}’s review.` : `Write a public response to ${name}’s review.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : mode === "edit" ? "Save response" : "Post response"}
          </Button>
        </>
      }
    >
      <div className="rounded-card bg-surface-low p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{name}</span>
          <Stars rating={review.rating} />
          <span className="text-xs text-ink-muted">{formatDate(review.date)}</span>
        </p>
        <p className="mt-2 text-sm text-ink">“{review.text}”</p>
      </div>
      <Textarea
        label="Public response"
        required
        rows={5}
        maxLength={RESPONSE_MAX}
        value={body}
        error={showError ? error : undefined}
        hint={`${body.length} / ${RESPONSE_MAX} · Your response will be visible with this review. Responses can be edited at any time.`}
        onChange={(event) => setBody(event.target.value)}
      />
      {problem && <FormAlert>{problem}</FormAlert>}
    </Modal>
  );
}
