import { Search } from "lucide-react";
import type { DiscoveryQuery } from "@/lib/marketplace-discovery";
import { CATEGORY_SLUG, locationLabel } from "@/lib/marketplace-discovery";

const field =
  "mt-1 block w-full rounded-btn border border-line bg-canvas px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary";
const label = "text-micro font-semibold tracking-wider text-ink-muted uppercase";

/**
 * The search: what is needed, and where. A plain GET form to /marketplace, so it works before any script has run and every search has an address
 * that can be shared and come back to. A Service, a category or a booking choice already made is kept (hidden fields) so a new search narrows the
 * same list; the page number is not (a new search starts at the first page).
 */
export function SearchForm({ query }: { query: DiscoveryQuery }) {
  const where = query.locationText || (query.location ? locationLabel(query.location) : "");
  return (
    <form action="/marketplace" method="get" role="search" aria-label="Search providers" className="rounded-card bg-surface p-4 shadow-overlay md:p-5">
      {query.service && <input type="hidden" name="service" value={query.service} />}
      {query.category && <input type="hidden" name="category" value={CATEGORY_SLUG[query.category]} />}
      {query.booking && <input type="hidden" name="booking" value={query.booking} />}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-end">
        <div>
          <label htmlFor="marketplace-q" className={label}>
            What do you need?
          </label>
          <input id="marketplace-q" name="q" type="search" defaultValue={query.q} maxLength={100} autoComplete="off" placeholder="AC repair, heat pump, furnace tune-up" className={field} />
        </div>
        <div>
          <label htmlFor="marketplace-location" className={label}>
            Where?
          </label>
          <input id="marketplace-location" name="location" type="text" defaultValue={where} maxLength={80} autoComplete="postal-code" placeholder="ZIP code or city, state" className={field} />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-btn bg-primary px-5 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover"
        >
          <Search aria-hidden className="size-4" />
          Search providers
        </button>
      </div>
    </form>
  );
}
