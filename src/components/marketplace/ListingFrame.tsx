import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Snowflake } from "lucide-react";
import type { AppHref } from "@/config/routes";
import { cn } from "@/lib/cn";

/**
 * The Climvia directory page around one business's listing: the directory's own header, the listing, and the footer. Shared by the
 * signed-in preview of the saved listing and by the public page of a published one, so they cannot drift apart.
 *
 * On the public page the header is a way back: the mark leads to the Marketplace, and `back` leads to the results the visitor came from.
 * The preview inside the workspace has neither (it is not part of the public Marketplace).
 */
export function ListingFrame({ businessName, narrow, back, children }: { businessName: string; narrow?: boolean; back?: { href: AppHref; label: string }; children: ReactNode }) {
  const mark = (
    <>
      <span aria-hidden className="flex size-8 items-center justify-center rounded-btn bg-primary text-white">
        <Snowflake className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold text-ink">Climvia</span>
        <span className="block text-micro font-semibold tracking-wider text-ink-muted uppercase">Marketplace</span>
      </span>
    </>
  );
  return (
    <div
      data-testid="directory-frame"
      className={cn("@container mx-auto overflow-hidden rounded-card border border-line bg-canvas shadow-card", narrow ? "max-w-[390px]" : "max-w-5xl")}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4">
        {back ? (
          <Link prefetch={false} href="/marketplace" className="flex items-center gap-2.5 rounded-btn">
            {mark}
          </Link>
        ) : (
          <div className="flex items-center gap-2.5">{mark}</div>
        )}
        {back && (
          <Link prefetch={false} href={back.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary">
            <ArrowLeft aria-hidden className="size-4" />
            {back.label}
          </Link>
        )}
      </header>
      {children}
      <footer className="border-t border-line bg-surface px-5 py-5 text-center text-xs text-ink-muted">
        © 2025 {businessName} · Listed on Climvia Marketplace
      </footer>
    </div>
  );
}
