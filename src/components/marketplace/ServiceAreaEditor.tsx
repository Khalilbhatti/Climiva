"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ServiceArea } from "@/data/marketplace";
import { US_STATES } from "@/data/settings";
import { AREA_LIMIT, areaDisplay, parseAreas } from "@/lib/marketplace-discovery";

type Kind = "city" | "postal";
type Draft = { kind: Kind; city: string; state: string; postal: string; label: string };

const EMPTY: Draft = { kind: "city", city: "", state: "", postal: "", label: "" };

/** An area in the one shape the page keeps (and the server returns), so two copies of the same list compare equal. */
const shaped = (area: ServiceArea): ServiceArea => ({ city: area.city, state: area.state, postal: area.postal, label: area.label });

const draftOf = (area: ServiceArea): Draft => ({ kind: area.city ? "city" : "postal", city: area.city ?? "", state: area.state ?? "", postal: area.postal ?? "", label: area.label ?? "" });

/** What the form holds, in the shape the server checks: exactly one of a city (with its state) or a ZIP, and an optional name. */
const inputOf = (draft: Draft) => ({
  city: draft.kind === "city" ? draft.city : null,
  state: draft.kind === "city" ? draft.state : null,
  postal: draft.kind === "postal" ? draft.postal : null,
  label: draft.label.trim() === "" ? null : draft.label,
});

/**
 * Where the business works: the places its listing claims. A place is a city and state or a ZIP code, with an optional name customers read ("South
 * Austin"). Add, change, remove and order them here; the list is saved with the rest of the listing, and the server checks it again. The business's
 * own address is never counted as a place it works: only what is listed here is.
 */
export function ServiceAreaEditor({ areas, onChange }: { areas: readonly ServiceArea[]; onChange: (areas: ServiceArea[]) => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [problem, setProblem] = useState<string>();

  const set = (change: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setProblem(undefined);
  };

  function commit() {
    const next = areas.map((area) => inputOf(draftOf(area)));
    const entry = inputOf(draft);
    if (editing === null) next.push(entry);
    else next[editing] = entry;
    const parsed = parseAreas(next);
    if (!parsed.ok) return setProblem(parsed.fields?.areas ?? parsed.error);
    onChange(parsed.value.map(shaped));
    setDraft(EMPTY);
    setEditing(null);
    setProblem(undefined);
  }

  function edit(index: number) {
    setEditing(index);
    setDraft(draftOf(areas[index]));
    setProblem(undefined);
  }

  function cancel() {
    setEditing(null);
    setDraft(EMPTY);
    setProblem(undefined);
  }

  function remove(index: number) {
    onChange(areas.filter((_, at) => at !== index).map(shaped));
    if (editing === index) cancel();
    else if (editing !== null && editing > index) setEditing(editing - 1);
  }

  function move(index: number, by: -1 | 1) {
    const next = areas.map(shaped);
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
    if (editing === index) setEditing(index + by);
    else if (editing === index + by) setEditing(index);
  }

  const enter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  };

  const full = editing === null && areas.length >= AREA_LIMIT;

  return (
    <div className="space-y-4">
      {areas.length === 0 ? (
        <p className="rounded-btn bg-surface-low px-3 py-3 text-sm text-ink-muted">
          No service areas yet. Customers who search by place won&apos;t find this listing until you add where you work.
        </p>
      ) : (
        <ul aria-label="Service areas" className="space-y-2">
          {areas.map((area, index) => {
            const name = areaDisplay(area);
            const detail = area.label ? (area.city ? `${area.city}, ${area.state}` : `ZIP ${area.postal}`) : area.city ? "City" : "ZIP code";
            return (
              <li key={`${area.city ?? ""}|${area.state ?? ""}|${area.postal ?? ""}`} className="flex items-center gap-3 rounded-btn bg-surface-low px-3 py-2.5">
                <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{name}</span>
                  <span className="block text-xs text-ink-muted">{detail}</span>
                </span>
                <button type="button" onClick={() => edit(index)} aria-label={`Edit ${name}`} className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink">
                  <Pencil aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${name} up`}
                  className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === areas.length - 1}
                  aria-label={`Move ${name} down`}
                  className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown aria-hidden className="size-4" />
                </button>
                <button type="button" onClick={() => remove(index)} aria-label={`Remove ${name}`} className="rounded-btn p-1 text-ink-muted hover:bg-danger-soft hover:text-danger">
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <fieldset className="space-y-3 rounded-card border border-line p-4" disabled={full}>
        <legend className="px-1 text-sm font-semibold text-ink">{editing === null ? "Add a service area" : "Change service area"}</legend>
        <div role="radiogroup" aria-label="Kind of area" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink">
          {(
            [
              { id: "city", label: "City and state" },
              { id: "postal", label: "ZIP code" },
            ] as const
          ).map((option) => (
            <label key={option.id} className="inline-flex cursor-pointer items-center gap-2">
              <input type="radio" name="area-kind" className="size-4 accent-primary" checked={draft.kind === option.id} onChange={() => set({ kind: option.id })} />
              {option.label}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.kind === "city" ? (
            <>
              <Input label="City" value={draft.city} maxLength={60} onChange={(event) => set({ city: event.target.value })} onKeyDown={enter} />
              <Select label="State" value={draft.state} onChange={(event) => set({ state: event.target.value })}>
                <option value="">Choose a state</option>
                {US_STATES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Input label="ZIP code" inputMode="numeric" maxLength={10} value={draft.postal} onChange={(event) => set({ postal: event.target.value })} onKeyDown={enter} />
          )}
          <div className="sm:col-span-2">
            <Input
              label="Name shown to customers (optional)"
              hint="For example, South Austin. Leave empty to show the city or ZIP code."
              value={draft.label}
              maxLength={60}
              onChange={(event) => set({ label: event.target.value })}
              onKeyDown={enter}
            />
          </div>
        </div>
        {problem && (
          <p role="alert" className="text-xs text-danger">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={commit}>
            {editing === null ? <Plus aria-hidden className="size-4" /> : <Pencil aria-hidden className="size-4" />}
            {editing === null ? "Add area" : "Update area"}
          </Button>
          {editing !== null && (
            <Button variant="tertiary" onClick={cancel}>
              Cancel
            </Button>
          )}
          <span className="text-xs text-ink-muted">
            {areas.length} of {AREA_LIMIT} areas
          </span>
        </div>
      </fieldset>
      {full && <p className="text-xs text-ink-muted">A listing can list up to {AREA_LIMIT} service areas. Remove one to add another.</p>}
    </div>
  );
}
