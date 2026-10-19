import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A provider's rating as a visitor reads it: one filled star, the average to one decimal and the number of reviews behind it. */
export function Rating({ rating, className }: { rating: { average: number; count: number }; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${plural(rating.count, "review")}`}
      className={cn("inline-flex items-center gap-1 text-sm font-semibold text-ink tabular-nums", className)}
    >
      <Star className="size-4 fill-warning-line text-warning" />
      {rating.average.toFixed(1)}
      <span className="font-normal text-ink-muted">({rating.count})</span>
    </span>
  );
}

/** A review's own rating: five stars, as many filled as it gave. */
export function StarRow({ value }: { value: number }) {
  return (
    <span role="img" aria-label={`${value} out of 5`} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden className={cn("size-3.5", n <= value ? "fill-warning-line text-warning" : "text-line-strong")} />
      ))}
    </span>
  );
}
