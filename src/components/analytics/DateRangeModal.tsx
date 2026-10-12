"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { RANGE_PRESETS, presetRange, type DateRange, type RangeId } from "@/lib/analytics-rules";
import { formatRange, validateCustomRange } from "@/lib/analytics-state";

/**
 * Choose the period the reports cover: a preset, or two dates. The dates are plain calendar dates, so the choice means the same
 * thing whatever the browser's timezone, and "this month" is the business's own month (`today` comes from the server).
 */
export function DateRangeModal({ current, today, onApply, onClose }: { current: DateRange; today: string; onApply: (range: DateRange) => void; onClose: () => void }) {
  const [choice, setChoice] = useState<RangeId>(current.id);
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);
  const [showError, setShowError] = useState(false);

  const customError = choice === "custom" ? validateCustomRange(from, to) : undefined;

  function apply() {
    if (customError) return setShowError(true);
    const preset = RANGE_PRESETS.find((item) => item.id === choice);
    onApply(preset ? presetRange(preset.id, today) : { id: "custom", from, to });
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
            description={formatRange(presetRange(preset.id, today).from, presetRange(preset.id, today).to)}
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
