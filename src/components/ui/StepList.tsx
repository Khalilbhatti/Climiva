import { cn } from "@/lib/cn";

type StepListProps = {
  steps: readonly { id: string; label: string }[];
  /** Zero-based index of the current step. */
  current: number;
  label: string;
};

/** Progress through a multi-step flow. The current step is announced with aria-current="step". */
export function StepList({ steps, current, label }: StepListProps) {
  return (
    <ol aria-label={label} className="flex flex-wrap gap-x-5 gap-y-2 rounded-card bg-surface-low px-4 py-3 text-xs">
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={index === current ? "step" : undefined}
          className={cn("flex items-center gap-2", index === current ? "font-semibold text-ink" : "text-ink-muted")}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-5 items-center justify-center rounded-full text-micro font-bold",
              index === current ? "bg-primary text-white" : index < current ? "bg-primary-subtle text-primary" : "bg-line text-ink-muted",
            )}
          >
            {index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
