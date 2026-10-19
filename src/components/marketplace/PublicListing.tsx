"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import { useBrandStyle, useBusiness } from "@/components/settings/SettingsProvider";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { ListingFrame } from "./ListingFrame";
import { ListingView } from "./ListingView";
import { useListingData } from "./listing-data";
import { useMarketplace } from "./MarketplaceProvider";

/**
 * The saved listing as the Climvia directory would show it, outside the workspace shell, for someone signed in to the business: no sidebar,
 * no workspace header and no internal state labels. The slim toolbar above it (back link, Desktop / Mobile) is the one thing the real
 * directory would not have. The page a visitor opens is /listings/<address>, which shows the listing only while it is published.
 */
export function PublicListing() {
  const { listing } = useMarketplace();
  const business = useBusiness();
  const brandStyle = useBrandStyle();
  const data = useListingData(listing.config);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const published = listing.status === "published";

  return (
    <div className="min-h-dvh bg-surface-low">
      <div className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/marketplace-listing" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary">
            <ArrowLeft aria-hidden className="size-4" />
            Back to Marketplace
          </Link>
          <div role="group" aria-label="Preview size" className="flex rounded-btn bg-surface-low p-1">
            {(
              [
                { id: "desktop", label: "Desktop", icon: Monitor },
                { id: "mobile", label: "Mobile", icon: Smartphone },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={device === option.id}
                onClick={() => setDevice(option.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                  device === option.id ? "bg-surface text-primary shadow-card" : "text-ink-muted hover:text-ink",
                )}
              >
                <option.icon aria-hidden className="size-3.5" />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
        <ListingFrame businessName={business.name} narrow={device === "mobile"}>
          {published ? (
            <div className="p-4 @2xl:p-6">
              <ListingView data={data} variant="page" style={brandStyle} />
            </div>
          ) : (
            <section className="px-6 py-16 text-center">
              <h1 className="text-xl font-bold text-ink">This listing isn&apos;t available</h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{business.name} is not listed in the Climvia Marketplace right now.</p>
              <ButtonLink href="/marketplace-listing" variant="secondary" className="mt-5">
                Back to Marketplace
              </ButtonLink>
            </section>
          )}
        </ListingFrame>
      </div>
    </div>
  );
}
