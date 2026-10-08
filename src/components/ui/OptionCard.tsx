import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type OptionCardProps = Omit<ComponentProps<"input">, "type" | "title"> & {
  type: "radio" | "checkbox";
  title: string;
  description?: ReactNode;
  /** Small trailing tag, e.g. "Recommended". */
  badge?: ReactNode;
};

/** A real radio/checkbox presented as a selectable card. The whole card is the click target. */
export function OptionCard({ type, title, description, badge, className, ...props }: OptionCardProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border border-line bg-canvas p-4 transition-colors hover:border-line-strong has-checked:border-primary has-checked:bg-primary-subtle has-disabled:cursor-not-allowed has-disabled:opacity-60",
        className,
      )}
    >
      <input type={type} className="mt-0.5 size-4 shrink-0 accent-primary" {...props} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {title}
          {badge}
        </span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Groups related OptionCards under one announced legend. */
export function OptionGroup({
  legend,
  hint,
  children,
  className,
}: {
  legend: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      <div className={cn("mt-3 grid gap-3", className)}>{children}</div>
    </fieldset>
  );
}
