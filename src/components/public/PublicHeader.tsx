import Link from "next/link";
import { cn } from "@/lib/cn";
import { PublicSessionNav, type NavTone } from "./PublicSessionNav";

/** The Climvia mark and name, as a link home. */
export function ClimviaBrand({ tone = "on-light", className }: { tone?: NavTone; className?: string }) {
  return (
    <Link prefetch={false} href="/" aria-label="Climvia home" className={cn("inline-flex items-center gap-2.5 rounded-btn", tone === "on-dark" ? "text-white focus-visible:outline-white" : "text-ink", className)}>
      <span aria-hidden className={cn("flex size-9 items-center justify-center rounded-btn text-lg font-bold tracking-tight shadow-card", tone === "on-dark" ? "bg-white text-primary" : "bg-primary text-white")}>
        C
      </span>
      <span className="text-xl font-bold tracking-tight">Climvia</span>
    </Link>
  );
}

/**
 * The header of Climvia's own public pages (the landing, and a provider's profile): the brand, the two ways in (find a service, or list a business) and the
 * account links. It reads no session; `PublicSessionNav` learns who is looking after the page has loaded. A platform administrator's console is not linked
 * from here for anyone but an administrator, and then only by that component.
 */
export function PublicHeader({ tone = "on-light", className }: { tone?: NavTone; className?: string }) {
  const link = tone === "on-dark" ? "rounded-btn px-1 py-1 text-sm font-semibold text-white/90 hover:text-white hover:underline focus-visible:outline-white" : "rounded-btn px-1 py-1 text-sm font-semibold text-ink-muted hover:text-primary hover:underline";
  return (
    <header className={className}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 py-4 sm:gap-x-6">
        <ClimviaBrand tone={tone} />
        <nav aria-label="Main" className="order-3 flex w-full items-center gap-5 sm:order-none sm:w-auto">
          <Link prefetch={false} href="/marketplace" className={link}>
            Marketplace
          </Link>
          <Link prefetch={false} href="/#for-businesses" className={link}>
            For HVAC businesses
          </Link>
        </nav>
        <PublicSessionNav tone={tone} />
      </div>
    </header>
  );
}
