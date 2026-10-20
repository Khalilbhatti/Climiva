import Link from "next/link";
import { SearchX, Store } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DiscoveryFacets, DiscoveryResults } from "@/data/marketplace-discovery";
import { discoveryHref, locationLabel, type DiscoveryQuery } from "@/lib/marketplace-discovery";
import { getMarketplaceFacets, getMarketplaceResults } from "@/server/public-site";
import { PublicSessionNav } from "@/components/public/PublicSessionNav";
import { ActiveFilters } from "./ActiveFilters";
import { FilterDisclosure } from "./FilterDisclosure";
import { appliedFilters, baseOf, FilterPanel } from "./FilterPanel";
import { MarketplaceFooter, MarketplaceWordmark } from "./MarketplaceChrome";
import { Pagination } from "./Pagination";
import { plural } from "./Rating";
import { ProviderCard } from "./ProviderCard";
import { SearchForm } from "./SearchForm";

/** Which address the page is: the Marketplace itself, or one of its clean Service / place / Service-in-place pages. */
export type DiscoveryMode = "index" | "service" | "location" | "combination";

/** "ac-repair-diagnostics" read as words, for a Service nobody offers (so its real name is not known). */
export const slugWords = (slug: string) => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The name of the Service the page is about: the one a provider really calls it, else its address read as words. */
export function serviceNameOf(query: DiscoveryQuery, facets: DiscoveryFacets, results: DiscoveryResults): string | null {
  if (!query.service) return null;
  const named = facets.services.find((service) => service.slug === query.service)?.name ?? results.results.find((card) => card.service?.slug === query.service)?.service?.name;
  return named ?? slugWords(query.service);
}

export const isNarrowed = (query: DiscoveryQuery) => Boolean(query.q || query.service || query.location || query.booking || query.category);

const BROWSE_SHOWN = 6;

const chip = "inline-block rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 focus-visible:outline-white";

function Hero({ query, mode, facets, serviceName }: { query: DiscoveryQuery; mode: DiscoveryMode; facets: DiscoveryFacets; serviceName: string | null }) {
  const place = query.location ? locationLabel(query.location) : null;
  const title =
    mode === "service" ? serviceName
    : mode === "location" ? `HVAC service in ${place}`
    : mode === "combination" ? `${serviceName} in ${place}`
    : "Find HVAC service in your area";
  const lead =
    mode === "index"
      ? "Search by the service you need and where you are. Compare providers by what they offer, where they work and what their customers say, then book or ask for an appointment online."
      : "Providers that list this on Climvia Marketplace. Narrow the search, or start a new one.";
  const browsing = mode === "index" && !isNarrowed(query);
  return (
    <section aria-labelledby="marketplace-title" className="relative overflow-hidden bg-primary text-white">
      <div aria-hidden className="pointer-events-none absolute -top-28 -right-28 hidden size-[30rem] rounded-full border border-white/10 md:block">
        <div className="absolute inset-10 rounded-full border border-white/10" />
        <div className="absolute inset-20 rounded-full border border-white/10" />
        <div className="absolute inset-[7.5rem] rounded-full border border-white/10" />
      </div>
      <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-10 md:pt-10 md:pb-14">
        <h1 id="marketplace-title" className="max-w-3xl text-3xl font-bold tracking-tight text-balance md:text-5xl md:leading-[1.05]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-base text-white/85">{lead}</p>
        <div className="mt-6 max-w-4xl">
          <SearchForm query={query} />
        </div>
        {browsing && (facets.services.length > 0 || facets.locations.length > 0) && (
          <div className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
            {facets.services.length > 0 && (
              <nav aria-label="Browse by service">
                <p className="text-micro font-semibold tracking-wider text-white/80 uppercase">Browse by service</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {facets.services.slice(0, BROWSE_SHOWN).map((service) => (
                    <li key={service.slug}>
                      <Link prefetch={false} href={discoveryHref({ service: service.slug })} className={chip}>
                        {service.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            {facets.locations.length > 0 && (
              <nav aria-label="Browse by place">
                <p className="text-micro font-semibold tracking-wider text-white/80 uppercase">Browse by place</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {facets.locations.slice(0, BROWSE_SHOWN).map((where) => (
                    <li key={where.slug}>
                      <Link prefetch={false} href={discoveryHref({ location: where.slug })} className={chip}>
                        {where.label || locationLabel(where.slug)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** What to say when there is nothing to list, and what the visitor can do about it. */
function Nothing({ query, pageBeyond }: { query: DiscoveryQuery; pageBeyond: boolean }) {
  if (pageBeyond) {
    return (
      <EmptyState
        icon={SearchX}
        title="That page of results doesn't exist"
        description="There are fewer results than that. Go back to the first page."
        action={
          <ButtonLink href={discoveryHref(baseOf(query))} variant="secondary">
            Go to the first page
          </ButtonLink>
        }
      />
    );
  }
  if (!isNarrowed(query)) {
    return <EmptyState icon={Store} title="No providers are listed yet" description="Businesses appear here once they publish their Marketplace listing and choose the services they offer." />;
  }
  const place = query.location ? locationLabel(query.location) : null;
  const description = place
    ? `No provider has listed ${place} as a place it works${query.service || query.q || query.category || query.booking ? " for this search" : ""}. A provider only appears for the places it lists.`
    : "No provider matches all of the words and filters in this search. Try fewer words or remove a filter.";
  return (
    <EmptyState
      icon={SearchX}
      title="No providers match this search"
      description={description}
      action={
        <ButtonLink href="/marketplace" variant="secondary">
          Clear the search
        </ButtonLink>
      }
    />
  );
}

/**
 * The Marketplace for a visitor: the search, what there is to filter by, and one page of providers. It is the body of every discovery address
 * (/marketplace and the clean Service and place pages), so a Service page is the same list with the Service already chosen. There is no session
 * and no workspace behind it: everything it shows is a public projection read from the database for this one request.
 */
export async function DiscoveryPage({ query, mode }: { query: DiscoveryQuery; mode: DiscoveryMode }) {
  const [results, facets] = await Promise.all([getMarketplaceResults(query), getMarketplaceFacets(query)]);
  const serviceName = serviceNameOf(query, facets, results);
  const pages = Math.max(1, Math.ceil(results.total / results.pageSize));
  const first = (results.page - 1) * results.pageSize + 1;
  const unreadPlace = query.locationText !== "" && !query.location;
  const pageBeyond = results.total > 0 && results.results.length === 0;
  const context = { service: query.service, location: query.location };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="bg-primary px-4 pt-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <MarketplaceWordmark />
          <PublicSessionNav tone="on-dark" />
        </div>
      </header>
      <main>
        <Hero query={query} mode={mode} facets={facets} serviceName={serviceName} />
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-8">
            <aside aria-label="Filters" className="mb-6 lg:mb-0">
              <FilterDisclosure active={appliedFilters(query)}>
                <FilterPanel query={query} facets={facets} />
              </FilterDisclosure>
            </aside>
            <section aria-labelledby="results-heading" className="min-w-0">
              <h2 id="results-heading" className="text-lg font-bold tracking-tight text-ink">
                {results.total > 0 ? plural(results.total, "provider") : "Providers"}
              </h2>
              {results.results.length > 0 && (
                <p className="text-sm text-ink-muted tabular-nums">
                  Showing {first}–{first + results.results.length - 1} of {results.total}. Best matches first, then highest rated.
                </p>
              )}
              <div className="mt-3">
                <ActiveFilters query={query} serviceName={serviceName} />
              </div>
              {unreadPlace && (
                <p role="status" className="mt-3 rounded-card border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning">
                  We didn&apos;t recognize “{query.locationText}” as a place, so it isn&apos;t applied. Try a five-digit ZIP code, or a city and state like “Austin, TX”.
                </p>
              )}
              {results.results.length === 0 ? (
                <div className="mt-6">
                  <Nothing query={query} pageBeyond={pageBeyond} />
                </div>
              ) : (
                <>
                  <ul aria-label="Providers" className="mt-4 space-y-4">
                    {results.results.map((provider) => (
                      <li key={provider.slug}>
                        <ProviderCard provider={provider} context={context} />
                      </li>
                    ))}
                  </ul>
                  <Pagination query={query} page={results.page} pages={pages} />
                </>
              )}
            </section>
          </div>
        </div>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
