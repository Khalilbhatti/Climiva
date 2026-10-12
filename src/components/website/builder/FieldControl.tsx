"use client";

import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/cn";
import type { FieldDef } from "@/lib/site-sections";

/** A choice between a few named options, drawn as one connected control (a real radio group underneath, so it works from the keyboard). */
export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1 text-xs font-medium text-ink">{legend}</legend>
      <div className="flex rounded-btn bg-surface-low p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex-1 cursor-pointer rounded px-3 py-1.5 text-center text-xs font-semibold text-ink-muted has-checked:bg-surface has-checked:text-primary has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-primary",
              disabled && "cursor-default opacity-60",
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ALIGNMENTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
] as const;

/**
 * The control for one declared text field of a section, chosen by the field's kind in the registry (lib/site-sections): a line, a few
 * lines, or an alignment. Nothing about a particular section type is written here: a field the registry declares gets its control.
 */
export function FieldControl({
  field,
  label,
  idBase,
  value,
  error,
  disabled,
  onChange,
  onBlur,
}: {
  field: FieldDef;
  label: string;
  idBase: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  if (field.kind === "align") {
    return <Segmented legend={label} name={`${idBase}-${field.key}`} value={value === "center" ? "center" : "left"} options={ALIGNMENTS} disabled={disabled} onChange={onChange} />;
  }
  const common = {
    label,
    value,
    disabled,
    maxLength: field.max,
    error,
    hint: `${value.length} / ${field.max}`,
    onBlur,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return field.kind === "textarea" ? <Textarea rows={4} {...common} /> : <Input {...common} />;
}
