"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ListingConfig, MarketplaceState } from "@/data/marketplace";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { hideListingAction, publishListingAction, saveListingAction, setUpListingAction } from "@/server/actions/marketplace";

type Done = Promise<ActionResult<{ marketplace: MarketplaceState }>>;

type MarketplaceContextValue = {
  /** The business's listing as stored: not set up, published or hidden, with its saved configuration. */
  listing: MarketplaceState;
  saveListing: (config: ListingConfig) => Done;
  publishListing: () => Done;
  hideListing: () => Done;
  setUpListing: (config: ListingConfig) => Done;
};

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

/**
 * The business's Marketplace listing for the whole workspace. `initial` is what the server read from PostgreSQL for this page load, for the
 * ACTIVE organization only. Every change goes to the server, which authorizes it (owner or admin), validates it, resolves every Service
 * the listing selects inside the business and stores it in one transaction; it answers with the listing as stored, and only then does the
 * working copy change, so the screen is never ahead of the database.
 */
export function MarketplaceProvider({ initial, children }: { initial: MarketplaceState; children: ReactNode }) {
  const [listing, setListing] = useState<MarketplaceState>(initial);

  const adopt = useCallback((result: ActionResult<{ marketplace: MarketplaceState }>) => {
    if (result.ok) setListing(result.data.marketplace);
    return result;
  }, []);

  const value = useMemo<MarketplaceContextValue>(
    () => ({
      listing,
      saveListing: async (config) => adopt(await send(() => saveListingAction({ config }))),
      publishListing: async () => adopt(await send(() => publishListingAction())),
      hideListing: async () => adopt(await send(() => hideListingAction())),
      setUpListing: async (config) => adopt(await send(() => setUpListingAction({ config }))),
    }),
    [listing, adopt],
  );

  return <MarketplaceContext value={value}>{children}</MarketplaceContext>;
}

export function useMarketplace(): MarketplaceContextValue {
  const context = useContext(MarketplaceContext);
  if (!context) throw new Error("useMarketplace must be used inside <MarketplaceProvider>.");
  return context;
}
