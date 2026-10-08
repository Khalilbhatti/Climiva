"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type TabItem = {
  id: string;
  label: string;
  /** Optional count chip, e.g. Requests (3). */
  count?: number;
};

type TabsProps = {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  /**
   * Prefix used to wire tabs to panels. Render each panel with
   * id={`${idPrefix}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${tab.id}`}.
   */
  idPrefix: string;
  /** "underline" for page sections; "segmented" for a compact view switcher (Day / Week). */
  variant?: "underline" | "segmented";
};

/** Controlled tab list with roving focus (←/→/Home/End). The parent owns the panels. */
export function Tabs({ tabs, value, onChange, label, idPrefix, variant = "underline" }: TabsProps) {
  const segmented = variant === "segmented";
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function handleKeyDown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={segmented ? "inline-flex gap-1 rounded-btn bg-surface-low p-1" : "flex gap-6 border-b border-line"}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[tab.id] = node;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex items-center gap-2 text-sm font-medium transition-colors",
              segmented
                ? cn("rounded px-3 py-1.5", selected ? "bg-surface text-primary shadow-card" : "text-ink-muted hover:text-ink")
                : cn(
                    "-mb-px border-b-2 px-1 pb-3",
                    selected ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink",
                  ),
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  selected ? "bg-primary text-white" : "bg-surface-low text-ink-muted",
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
