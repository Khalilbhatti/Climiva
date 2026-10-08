import { useId, type ReactNode } from "react";

/** Props every control inside a FormField must receive to stay labelled and described. */
export type FieldControlProps = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  "aria-required"?: true;
};

type FormFieldProps = {
  /** Visible label: always rendered, never a placeholder substitute. */
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Visually hide the label (still announced) when a surrounding heading already names the control, e.g. a filter bar. */
  hideLabel?: boolean;
  /** Use a caller-supplied id instead of a generated one. */
  id?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/** Label + control + hint/error, with the ARIA wiring done once. Input, Select and Textarea build on it. */
export function FormField({ label, hint, error, required, hideLabel, id, children }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div>
      <label htmlFor={fieldId} className={hideLabel ? "sr-only" : "mb-1 block text-xs font-medium text-ink"}>
        {label}
        {required && (
          <span aria-hidden className="text-danger">
            {" "}
            *
          </span>
        )}
      </label>
      {children({
        id: fieldId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": messageId,
        "aria-required": required ? true : undefined,
      })}
      {error ? (
        <p id={messageId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
