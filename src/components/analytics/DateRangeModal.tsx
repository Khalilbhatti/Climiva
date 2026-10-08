"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { RANGE_PRESETS, type RangeId } from "@/data/analytics";
import { formatRange, validateCustomRange, type DateRange } from "@/lib/analytics-state";

/**
 * Choose the period the reports cover: a preset, or two dates. The dates are plain calendar dates, so the choice means
 * the same thing whatever the browser's timezone, and "this month" is the prototype's month, never the real one.
 */
export function DateRangeModal({ current, onApply, onClose }: { current: DateRange; onApply: (range: DateRange) => void; onClose: () => void }) {
  const [choice, setChoice] = useState<RangeId>(current.id);
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);
  const [showError, setShowError] = useState(false);

  const customError = choice === "custom" ? validateCustomRange(from, to) : undefined;

  function apply() {
    if (customError) return setShowError(true);
    const preset = RANGE_PRESETS.find((item) => item.id === choice);
    onApply(preset ? { id: preset.id, from: preset.from, to: preset.to } : { id: "custom", from, to });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Select date range"
      description="Choose the period the reports cover."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply range</Button>
        </>
      }
    >
      <OptionGroup legend="Period">
        {RANGE_PRESETS.map((preset) => (
          <OptionCard
            key={preset.id}
            type="radio"
            name="analytics-range"
            title={preset.label}
            description={formatRange(preset.from, preset.to)}
            checked={choice === preset.id}
            onChange={() => setChoice(preset.id)}
          />
        ))}
        <OptionCard
          type="radio"
          name="analytics-range"
          title="Custom range"
          description="Pick a start date and an end date."
          checked={choice === "custom"}
          onChange={() => setChoice("custom")}
        />
      </OptionGroup>

      {choice === "custom" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="From" type="date" required value={from} onChange={(event) => setFrom(event.target.value)} error={showError ? customError : undefined} />
          <Input label="To" type="date" required value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      )}
    </Modal>
  );
}
