import Link from "next/link";
import { X } from "lucide-react";
import { BOOKING_METHOD_LABEL } from "@/data/services";
import { discoveryHref, locationLabel, type DiscoveryQuery } from "@/lib/marketplace-discovery";
import { baseOf } from "./FilterPanel";

/** What the results are narrowed by, each a chip that removes itself. */
export function ActiveFilters({ query, serviceName }: { query: DiscoveryQuery; serviceName: string | null }) {
  const base = baseOf(query);
  const without = (patch: Partial<typeof base>) => discoveryHref({ ...base, ...patch });
  const chips: { key: string; label: string; remove: ReturnType<typeof discoveryHref> }[] = [];
  if (query.q) chips.push({ key: "q", label: `“${query.q}”`, remove: without({ q: "" }) });
  if (query.service) chips.push({ key: "service", label: serviceName ?? query.service, remove: without({ service: null }) });
  if (query.category) chips.push({ key: "category", label: query.category, remove: without({ category: null }) });
  if (query.booking) chips.push({ key: "booking", label: BOOKING_METHOD_LABEL[query.booking], remove: without({ booking: null }) });
  if (query.location) chips.push({ key: "location", label: locationLabel(query.location), remove: without({ location: null, locationText: "" }) });
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Applied filters" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link prefetch={false}
            href={chip.remove}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-2 pl-3 text-sm text-ink hover:bg-surface-low"
          >
            {chip.label}
            <X aria-hidden className="size-3.5 text-ink-muted" />
            <span className="sr-only">Remove filter</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
