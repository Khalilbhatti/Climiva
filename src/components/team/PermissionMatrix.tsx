"use client";

import { cn } from "@/lib/cn";
import {
  MODULE_INFO,
  PERMISSION_GROUPS,
  PERMISSION_LEVELS,
  type ModuleId,
  type PermissionLevel,
  type Permissions,
} from "@/data/team";

type PermissionMatrixProps = {
  value: Permissions;
  /** Omit (or set `disabled`) for a read-only view. */
  onChange?: (next: Permissions) => void;
  disabled?: boolean;
  /** Keeps radio names unique when two matrices are on one page. */
  idPrefix: string;
};

/**
 * One row per workspace module with No access / View / Manage. Every row is a labelled radio group, so it
 * works by keyboard and screen reader; the chosen level is also shown as text, never by colour alone.
 * This only edits demo configuration: nothing in the app enforces these levels.
 */
export function PermissionMatrix({ value, onChange, disabled = false, idPrefix }: PermissionMatrixProps) {
  const locked = disabled || !onChange;

  function choose(module: ModuleId, level: PermissionLevel) {
    onChange?.({ ...value, [module]: level });
  }

  return (
    <div className="space-y-6">
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`${idPrefix}-${group.id}`}>
          <h3
            id={`${idPrefix}-${group.id}`}
            className="mb-2 flex items-center justify-between text-micro font-bold tracking-wider text-ink-muted uppercase"
          >
            {group.label}
            <span className="font-medium normal-case">{group.modules.length} modules</span>
          </h3>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {group.modules.map((module) => {
              const info = MODULE_INFO[module];
              const name = `${idPrefix}-${module}`;
              return (
                <li key={module} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{info.label}</p>
                    <p className="text-xs text-ink-muted">{info.description}</p>
                  </div>
                  <fieldset disabled={locked} className="shrink-0">
                    <legend className="sr-only">{info.label} access</legend>
                    <div className="inline-flex rounded-btn bg-surface-low p-1">
                      {PERMISSION_LEVELS.map((level) => (
                        <label key={level.id} className={cn("relative", locked ? "cursor-default" : "cursor-pointer")}>
                          <input
                            type="radio"
                            name={name}
                            value={level.id}
                            checked={value[module] === level.id}
                            onChange={() => choose(module, level.id)}
                            className="peer sr-only"
                          />
                          <span
                            className={cn(
                              "block rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors",
                              "peer-checked:bg-primary peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1",
                              !locked && "hover:text-ink peer-checked:hover:text-white",
                              locked && "peer-checked:opacity-90",
                            )}
                          >
                            {level.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
