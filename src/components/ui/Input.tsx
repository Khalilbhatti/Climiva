import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { FormField } from "./FormField";

/** Shared field surface: warm canvas at rest, white and ringed when focused. */
export const fieldClasses =
  "w-full rounded-btn border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

type InputProps = ComponentProps<"input"> & {
  /** Visible label: always rendered, never a placeholder substitute. */
  label: string;
  hint?: string;
  error?: string;
};

export function Input({ label, hint, error, id, required, className, ...props }: InputProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} id={id}>
      {(field) => <input {...field} required={required} className={cn(fieldClasses, error && "border-danger", className)} {...props} />}
    </FormField>
  );
}
