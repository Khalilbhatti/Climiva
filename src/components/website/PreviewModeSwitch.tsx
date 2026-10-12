"use client";

import { Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { PREVIEW_MODES, type PreviewModeId } from "./preview-modes";

const ICONS: Record<PreviewModeId, LucideIcon> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

/** The Desktop / Tablet / Mobile choice (see preview-modes): which width a website is drawn at. A viewport simulation, nothing stored. */
export function PreviewModeSwitch({ value, onChange }: { value: PreviewModeId; onChange: (mode: PreviewModeId) => void }) {
  return (
    <div role="group" aria-label="Preview size" className="flex rounded-btn bg-surface-low p-1">
      {PREVIEW_MODES.map((mode) => {
        const Icon = ICONS[mode.id];
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={value === mode.id}
            title={`${mode.label}, ${mode.width} pixels wide`}
            onClick={() => onChange(mode.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
              value === mode.id ? "bg-surface text-primary shadow-card" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
