import type { ReactNode } from "react";
import { Snowflake } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The Climvia directory page around one business's listing: the directory's own header, the listing, and the footer. Shared by the
 * signed-in preview of the saved listing and by the public page of a published one, so they cannot drift apart.
 */
export function ListingFrame({ businessName, narrow, children }: { businessName: string; narrow?: boolean; children: ReactNode }) {
  return (
    <div
      data-testid="directory-frame"
      className={cn("@container mx-auto overflow-hidden rounded-card border border-line bg-canvas shadow-card", narrow ? "max-w-[390px]" : "max-w-5xl")}
    >
      <header className="flex items-center gap-2.5 border-b border-line bg-surface px-5 py-4">
        <span aria-hidden className="flex size-8 items-center justify-center rounded-btn bg-primary text-white">
          <Snowflake className="size-4" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold text-ink">Climvia</span>
          <span className="block text-micro font-semibold tracking-wider text-ink-muted uppercase">Marketplace</span>
        </span>
      </header>
      {children}
      <footer className="border-t border-line bg-surface px-5 py-5 text-center text-xs text-ink-muted">
        © 2025 {businessName} · Listed on Climvia Marketplace
      </footer>
    </div>
  );
}
