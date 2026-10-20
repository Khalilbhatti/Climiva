"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleCheck, Star } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { REVIEW_TEXT_MAX } from "@/data/reviews";
import { cn } from "@/lib/cn";
import { send } from "@/lib/send-action";
import { parseReviewSubmission } from "@/lib/review-rules";
import { submitReviewAction, type ReviewOutcome } from "@/server/actions/public-review";

type Finished = { outcome: ReviewOutcome; public: boolean };

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * The customer's side of a review request: how it went, in their own words, and whether the business may show it publicly. The choice to show it is a
 * checkbox that starts UNCHECKED, in words that say exactly what public means (and that the name shown is the first name and last initial, which is not
 * anonymous). Nothing the customer is not told about is sent: the link's secret is a prop, never shown, and no organization or customer is named by this
 * form; the server takes both from the link.
 */
export function CustomerReviewForm({ token, business, displayName }: { token: string; business: string; displayName: string }) {
  const [rating, setRating] = useState("");
  const [text, setText] = useState("");
  const [showPublicly, setShowPublicly] = useState(false);
  const [errors, setErrors] = useState<{ rating?: string; text?: string }>({});
  const [problem, setProblem] = useState<string>();
  const [pending, setPending] = useState(false);
  const [finished, setFinished] = useState<Finished>();
  const form = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setProblem(undefined);
    const checked = parseReviewSubmission({ rating, text, showPublicly: showPublicly ? "yes" : "no" });
    if (!checked.ok) {
      setErrors({ rating: checked.fields?.rating, text: checked.fields?.text });
      if (!checked.fields) setProblem(checked.error);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    setPending(true);
    const result = await send(() => submitReviewAction({ token, rating, text, showPublicly: showPublicly ? "yes" : "no" }));
    setPending(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setFinished(result.data);
  }

  if (finished) {
    if (finished.outcome === "submitted") {
      return (
        <div role="status" className="space-y-3">
          <p className="flex items-center gap-2 text-lg font-semibold text-positive">
            <CircleCheck aria-hidden className="size-5" />
            Thank you. Your review was sent.
          </p>
          {finished.public ? (
            <p className="text-sm text-ink-muted">
              As you chose, {business} can show your review on its Climvia Marketplace profile as {displayName}, with your rating, your words and the date.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">You kept your review private, so only {business} can read it.</p>
          )}
        </div>
      );
    }
    return (
      <div role="status" className="space-y-2">
        <p className="text-lg font-semibold text-ink">{finished.outcome === "completed" ? "This review has already been sent" : finished.outcome === "expired" ? "This link has expired" : "This link isn't valid"}</p>
        <p className="text-sm text-ink-muted">
          {finished.outcome === "completed"
            ? `Each review link works once, and this one was used. Thank you for your feedback.`
            : `Ask ${business} for a new link if you still want to leave a review.`}
        </p>
      </div>
    );
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-6">
      {problem && <FormAlert>{problem}</FormAlert>}

      <fieldset className="space-y-2" aria-describedby={errors.rating ? "rating-error" : undefined}>
        <legend className="text-sm font-semibold text-ink">
          Your rating <span className="text-danger" aria-hidden>*</span>
          <span className="sr-only"> (required)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {STARS.map((value) => (
            <label key={value} className="relative cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === String(value)}
                onChange={() => setRating(String(value))}
                data-invalid={errors.rating ? "true" : undefined}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-w-16 flex-col items-center gap-1 rounded-btn border px-3 py-2 text-sm font-semibold transition-colors",
                  "border-line bg-surface text-ink-muted peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
                  "peer-checked:border-primary peer-checked:bg-primary-subtle peer-checked:text-primary",
                  errors.rating && "border-danger",
                )}
              >
                <Star aria-hidden className={cn("size-5", rating !== "" && Number(rating) >= value ? "fill-warning text-warning" : "")} />
                <span>
                  {value}
                  <span className="sr-only"> {value === 1 ? "star" : "stars"}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-muted">1 is poor, 5 is excellent.</p>
        {errors.rating && (
          <p id="rating-error" role="alert" className="text-sm text-danger">
            {errors.rating}
          </p>
        )}
      </fieldset>

      <Textarea
        label="Your review"
        required
        rows={6}
        maxLength={REVIEW_TEXT_MAX}
        value={text}
        error={errors.text}
        hint={`Tell ${business} and other customers how it went. Up to ${REVIEW_TEXT_MAX} characters.`}
        onChange={(event) => setText(event.target.value)}
      />

      <fieldset className="space-y-2 rounded-card border border-line bg-surface-low p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Showing your review publicly</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="showPublicly" value="yes" checked={showPublicly} onChange={(event) => setShowPublicly(event.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" aria-describedby="public-help" />
          <span className="text-sm font-medium text-ink">Yes, {business} may show my review on its public Climvia Marketplace profile.</span>
        </label>
        <p id="public-help" className="text-sm text-ink-muted">
          If you tick this, anyone can read your rating, your words and the date, under the name <strong className="font-semibold text-ink">{displayName}</strong> (your first name and last initial; it is not
          anonymous). It counts toward {business}&apos;s public rating. {business} always sees your full review, whatever you choose here. If you leave this unticked, your review stays private to {business}.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Sending…" : "Send review"}
        </Button>
        <p className="text-xs text-ink-muted">
          Your review is sent to {business} through Climvia.{" "}
          <Link href="/" className="font-semibold text-primary hover:underline">
            About Climvia
          </Link>
        </p>
      </div>
    </form>
  );
}
