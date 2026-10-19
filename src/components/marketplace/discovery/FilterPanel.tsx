import type { ReactNode } from "react";
import Link from "next/link";
import type { DiscoveryFacets } from "@/data/marketplace-discovery";
import { BOOKING_METHOD_LABEL } from "@/data/services";
import { cn } from "@/lib/cn";
import { discoveryHref, locationLabel, type DiscoveryQuery } from "@/lib/marketplace-discovery";

/** How many of a long list are shown. The lists are what providers really offer, so they are cut, never padded. */
const SHOWN = 10;

/** The choices that make up a search, as the parts of an address (the page number is never one of them). */
export const baseOf = (query: DiscoveryQuery) => ({ q: query.q, service: query.service, location: query.location, locationText: query.locationText, booking: query.booking, category: query.category });

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{title}</h3>
      <ul className="mt-2 space-y-0.5">{children}</ul>
    </section>
  );
}

function Choice({ href, selected, count, children }: { href: ReturnType<typeof discoveryHref>; selected: boolean; count?: number; children: ReactNode }) {
  return (
    <li>
      <Link prefetch={false}
        href={href}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex items-baseline justify-between gap-3 rounded-btn px-2.5 py-1.5 text-sm transition-colors",
          selected ? "bg-primary-subtle font-semibold text-primary" : "text-ink hover:bg-surface-low",
        )}
      >
        <span className="min-w-0">{children}</span>
        {count !== undefined && <span className="shrink-0 text-xs text-ink-muted tabular-nums">{count}</span>}
      </Link>
    </li>
  );
}

/** How many of the four filters (Service, category, booking, place) are applied. */
export const appliedFilters = (query: DiscoveryQuery) => [query.service, query.category, query.booking, query.location].filter(Boolean).length;

/**
 * What there is to choose from, given what has been chosen: every entry is a Service, place, category or booking choice that at least one
 * discoverable provider really has, with how many. Each is a link to the search it names; the one in use is marked.
 */
export function FilterPanel({ query, facets }: { query: DiscoveryQuery; facets: DiscoveryFacets }) {
  const base = baseOf(query);
  const withBase = (patch: Partial<typeof base>) => discoveryHref({ ...base, ...patch });
  const applied = appliedFilters(query);
  const nothing = !facets.services.length && !facets.categories.length && !facets.bookingModes.length && !facets.locations.length;
  if (nothing && applied === 0) return null;

  return (
    <div data-testid="marketplace-filters">
      <h2 className="sr-only">Filters</h2>
      {applied > 0 && (
        <p className="mb-3">
          <Link prefetch={false} href={withBase({ service: null, category: null, booking: null, location: null, locationText: "" })} className="text-sm font-semibold text-primary hover:underline">
            Clear filters
          </Link>
        </p>
      )}
      {facets.services.length > 0 && (
        <Group title="Service">
          <Choice href={withBase({ service: null })} selected={!query.service}>
            All services
          </Choice>
          {facets.services.slice(0, SHOWN).map((service) => (
            <Choice key={service.slug} href={withBase({ service: service.slug })} selected={query.service === service.slug} count={service.providers}>
              {service.name}
            </Choice>
          ))}
        </Group>
      )}
      {facets.categories.length > 0 && (
        <Group title="Type of work">
          {facets.categories.map((category) => (
            <Choice key={category.name} href={withBase({ category: query.category === category.name ? null : category.name })} selected={query.category === category.name} count={category.providers}>
              {category.name}
            </Choice>
          ))}
        </Group>
      )}
      {facets.bookingModes.length > 0 && (
        <Group title="Booking">
          {facets.bookingModes.map((mode) => (
            <Choice key={mode.mode} href={withBase({ booking: query.booking === mode.mode ? null : mode.mode })} selected={query.booking === mode.mode} count={mode.providers}>
              {BOOKING_METHOD_LABEL[mode.mode]}
            </Choice>
          ))}
        </Group>
      )}
      {facets.locations.length > 0 && (
        <Group title="Where they work">
          {facets.locations.slice(0, SHOWN).map((place) => (
            <Choice key={place.slug} href={withBase({ location: query.location === place.slug ? null : place.slug, locationText: "" })} selected={query.location === place.slug} count={place.providers}>
              {place.label || locationLabel(place.slug)}
            </Choice>
          ))}
        </Group>
      )}
    </div>
  );
}
