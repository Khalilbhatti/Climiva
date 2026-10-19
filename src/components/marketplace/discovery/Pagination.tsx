import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { discoveryHref, type DiscoveryQuery } from "@/lib/marketplace-discovery";
import { baseOf } from "./FilterPanel";

/** The page numbers to link: the first, the last, and the pages around the current one, with a gap marked where pages are left out. */
export function pageWindow(current: number, last: number): (number | "gap")[] {
  const wanted = new Set([1, last, current - 1, current, current + 1].filter((page) => page >= 1 && page <= last));
  const pages = [...wanted].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  for (const [index, page] of pages.entries()) {
    if (index > 0 && page - pages[index - 1] > 1) items.push("gap");
    items.push(page);
  }
  return items;
}

const step = "inline-flex items-center gap-1 rounded-btn border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-hover";

/** Previous, next and the numbered pages. Every page is a link with its own address; nothing here needs a script. */
export function Pagination({ query, page, pages }: { query: DiscoveryQuery; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (target: number) => discoveryHref({ ...baseOf(query), page: target });
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <Link prefetch={false} href={href(page - 1)} rel="prev" className={step}>
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </Link>
      ) : (
        <span aria-hidden className="w-24" />
      )}
      <ol className="flex items-center gap-1">
        {pageWindow(page, pages).map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden className="px-1 text-ink-muted">
              …
            </li>
          ) : (
            <li key={item}>
              <Link prefetch={false}
                href={href(item)}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
                className={cn("inline-flex min-w-9 items-center justify-center rounded-btn px-2.5 py-2 text-sm font-medium tabular-nums", item === page ? "bg-primary text-white" : "text-ink hover:bg-surface-low")}
              >
                {item}
              </Link>
            </li>
          ),
        )}
      </ol>
      {page < pages ? (
        <Link prefetch={false} href={href(page + 1)} rel="next" className={step}>
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span aria-hidden className="w-24" />
      )}
    </nav>
  );
}
