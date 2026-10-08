import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { FormField } from "./FormField";
import { fieldClasses } from "./Input";

type SelectProps = ComponentProps<"select"> & {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
};

export function Select({ label, hint, error, hideLabel, id, required, className, children, ...props }: SelectProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} id={id}>
      {(field) => (
        <select {...field} className={cn(fieldClasses, "pr-8", error && "border-danger", className)} {...props}>
          {children}
        </select>
      )}
    </FormField>
  );
}
