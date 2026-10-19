import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { PAGE_SIZE } from "@/db/platform-queries";
import { consoleHref, groupDigits } from "./format";

/** A search that works without JavaScript: a plain GET form, so a result is a link that can be shared with another administrator. */
export function SearchBox({ path, query, label, extra, hidden }: { path: string; query: string; label: string; extra?: ReactNode; hidden?: Record<string, string> }) {
  return (
    <form action={path} method="get" role="search" className="flex flex-wrap items-center gap-3">
      <SearchInput name="q" defaultValue={query} aria-label={label} wrapperClassName="w-full max-w-sm" />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {extra}
      <button type="submit" className={buttonClasses({ variant: "secondary", size: "md" })}>
        Search
      </button>
      {query && (
        <Link href={consoleHref(path)} className="text-sm font-semibold text-primary hover:underline">
          Clear
        </Link>
      )}
    </form>
  );
}

/** "Showing 1–25 of 140" with previous and next, keeping the search. */
export function Pager({ path, query, page, total, extra = {} }: { path: string; query: string; page: number; total: number; extra?: Record<string, string | number | null | undefined> }) {
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const current = Math.min(page, pages);
  const from = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, total);
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4 text-sm text-ink-muted">
      <p>
        {total === 0 ? "Nothing to show" : `Showing ${groupDigits(from)}–${groupDigits(to)} of ${groupDigits(total)}`}
      </p>
      <div className="flex items-center gap-2">
        {current > 1 ? (
          <Link href={consoleHref(path, { ...extra, q: query, page: current - 1 })} rel="prev" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Previous
          </Link>
        ) : null}
        {current < pages ? (
          <Link href={consoleHref(path, { ...extra, q: query, page: current + 1 })} rel="next" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
