import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { FormField } from "./FormField";
import { fieldClasses } from "./Input";

type TextareaProps = ComponentProps<"textarea"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Textarea({ label, hint, error, id, required, className, ...props }: TextareaProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} id={id}>
      {(field) => (
        <textarea {...field} className={cn(fieldClasses, "min-h-24 resize-y", error && "border-danger", className)} {...props} />
      )}
    </FormField>
  );
}
