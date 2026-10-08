import { cn } from "@/lib/cn";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Names the control for assistive tech, e.g. "Show Hero section". */
  label: string;
  disabled?: boolean;
};

/** A real on/off switch (role="switch") for settings that apply immediately. */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute left-0.5 size-5 rounded-full bg-white shadow-card transition-transform", checked && "translate-x-5")}
      />
    </button>
  );
}
