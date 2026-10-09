"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOperations } from "@/components/operations/OperationsProvider";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { cn } from "@/lib/cn";
import { MIN_QUERY, SEARCH_GROUPS, searchWorkspace } from "@/lib/global-search";

/**
 * Global search: Customers, Jobs, Bookings and Schedule, found from the same records the modules show. Those records are the
 * ACTIVE business's own, read from PostgreSQL for this page load, so another business's customers, jobs and bookings
 * cannot be found whatever is typed. It is a combobox: type, move through the results with the arrow keys, Enter opens
 * one, Escape closes the list (and a second Escape clears the field). ⌘K / Ctrl+K focuses it from anywhere.
 */
export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { data } = useOperations();
  const dir = useDirectory();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [shownOn, setShownOn] = useState(pathname);

  // A new page starts with an empty search.
  if (pathname !== shownOn) {
    setShownOn(pathname);
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  const text = query.trim();
  const results = useMemo(() => searchWorkspace(query, data, dir), [query, data, dir]);
  const searching = text.length >= MIN_QUERY;
  const listed = open && searching && results.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  function finish() {
    setOpen(false);
    setQuery("");
    setActive(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!searching || results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current === -1 ? (step === 1 ? 0 : results.length - 1) : (current + step + results.length) % results.length));
    } else if (event.key === "Enter" && listed && active >= 0) {
      event.preventDefault();
      router.push(results[active].href);
      finish();
    } else if (event.key === "Escape") {
      if (listed) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        event.preventDefault();
        finish();
      }
    }
  }

  return (
    <div ref={rootRef} role="search" className="relative mx-2 min-w-0 max-w-xl flex-1 lg:mx-8">
      <SearchInput
        ref={inputRef}
        role="combobox"
        aria-label="Search customers, jobs, bookings and schedule"
        aria-expanded={listed}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listed && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Search customers, jobs, bookings, schedule..."
        shortcutHint="⌘K"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {open && searching && (
        <div className="absolute top-full right-0 left-0 z-40 mt-2 max-h-[min(28rem,calc(100dvh-5rem))] overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-overlay">
          {results.length === 0 ? (
            <p role="status" className="px-3 py-3 text-sm text-ink-muted">
              No matches for “{text}”.
            </p>
          ) : (
            <div id={listId} role="listbox" aria-label="Search results">
              {SEARCH_GROUPS.map((group) => {
                const items = results.map((result, index) => ({ result, index })).filter((item) => item.result.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} role="group" aria-labelledby={`${listId}-${group}`} className="py-1">
                    <p id={`${listId}-${group}`} className="px-3 pt-1 pb-1 text-micro font-bold tracking-wider text-ink-muted uppercase">
                      {group}
                    </p>
                    {items.map(({ result, index }) => (
                      <Link
                        key={`${result.group}-${result.id}`}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === active}
                        tabIndex={-1}
                        href={result.href}
                        onClick={finish}
                        className={cn("block rounded-btn px-3 py-2 text-sm", index === active ? "bg-primary-subtle" : "hover:bg-surface-low")}
                      >
                        <span className="block truncate font-medium text-ink">{result.title}</span>
                        <span className="block truncate text-xs text-ink-muted">{result.detail}</span>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
