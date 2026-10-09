"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useServices } from "@/components/services/ServicesProvider";
import { initialMarketplaceState, type ListingConfig, type MarketplaceState } from "@/data/marketplace";
import * as state from "@/lib/marketplace-state";

type MarketplaceContextValue = {
  /** The working listing: the baseline plus any demo edits made in this session. */
  listing: MarketplaceState;
  saveListing: (config: ListingConfig) => void;
  publishListing: () => void;
  hideListing: () => void;
  setUpListing: (config: ListingConfig) => void;
};

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

/**
 * The demo copy of the Marketplace listing. Mounted at the app root because the public directory preview sits outside the
 * workspace shell yet must show what was saved inside it. In memory only; a reload restores the baseline.
 */
export function MarketplaceProvider({ children }: { children: ReactNode }) {
  // Starts from the business's Services as they were when the page loaded; the listing's own choices are held here.
  const { services } = useServices();
  const [listing, setListing] = useState<MarketplaceState>(() => initialMarketplaceState(services));
  const latest = useRef(listing);

  const commit = useCallback((next: MarketplaceState) => {
    latest.current = next;
    setListing(next);
  }, []);

  const value = useMemo<MarketplaceContextValue>(
    () => ({
      listing,
      saveListing: (config) => commit(state.saveListing(latest.current, config)),
      publishListing: () => commit(state.publishListing(latest.current)),
      hideListing: () => commit(state.hideListing(latest.current)),
      setUpListing: (config) => commit(state.setUpListing(latest.current, config)),
    }),
    [listing, commit],
  );

  return <MarketplaceContext value={value}>{children}</MarketplaceContext>;
}

export function useMarketplace(): MarketplaceContextValue {
  const context = useContext(MarketplaceContext);
  if (!context) throw new Error("useMarketplace must be used inside <MarketplaceProvider>.");
  return context;
}
