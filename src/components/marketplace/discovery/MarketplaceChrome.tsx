import type { ReactNode } from "react";
import Link from "next/link";
import { Snowflake } from "lucide-react";

/** The Marketplace's name and mark, as a link home. White on the teal band of the discovery pages. */
export function MarketplaceWordmark({ className }: { className?: string }) {
  return (
    <Link prefetch={false} href="/marketplace" className={className ?? "inline-flex items-center gap-2.5 rounded-btn text-white focus-visible:outline-white"}>
      <span aria-hidden className="flex size-8 items-center justify-center rounded-btn bg-white/15">
        <Snowflake className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold">Climvia</span>
        <span className="block text-micro font-semibold tracking-wider uppercase opacity-80">Marketplace</span>
      </span>
    </Link>
  );
}

/** The foot of every discovery page: what the Marketplace is, and who writes what is on it. */
export function MarketplaceFooter(): ReactNode {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-muted">
        <p className="max-w-2xl">
          Climvia Marketplace lists HVAC businesses that use Climvia. Each business writes its own profile, chooses the services it shows and says where it works.
          Ratings come from reviews the business&apos;s customers have made public.
        </p>
      </div>
    </footer>
  );
}
