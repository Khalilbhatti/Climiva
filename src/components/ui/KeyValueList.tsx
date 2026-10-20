import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type KeyValueItem = { label: string; value: ReactNode };

type KeyValueListProps = {
  items: KeyValueItem[];
  /** rows: label left, value right. tiles: bordered cells with the label above the value. */
  layout?: "rows" | "tiles";
  className?: string;
};

/** Semantic description list for record facts (contact details, equipment specs). */
export function KeyValueList({ items, layout = "rows", className }: KeyValueListProps) {
  if (layout === "tiles") {
    return (
      <dl className={cn("grid grid-cols-2 gap-2", className)}>
        {items.map((item) => (
          <div key={item.label} className="rounded-btn border border-line bg-surface px-3 py-2">
            <dt className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{item.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className={cn("space-y-1.5 text-sm", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">{item.label}</dt>
          <dd className="min-w-0 text-right font-medium text-ink [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
