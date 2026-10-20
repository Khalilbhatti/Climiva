import Link from "next/link";
import { ClimviaBrand } from "./PublicHeader";

/** The foot of Climvia's own public pages. Plain links to the three places a visitor can go; nothing here depends on who is looking. */
export function PublicFooter() {
  const link = "rounded-btn text-sm font-semibold text-ink-muted hover:text-primary hover:underline";
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm space-y-2">
          <ClimviaBrand />
          <p className="text-sm text-ink-muted">Climvia is business software for HVAC companies, and a Marketplace where homeowners find them.</p>
        </div>
        <nav aria-label="Climvia" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link prefetch={false} href="/marketplace" className={link}>
            Find a service
          </Link>
          <Link prefetch={false} href="/signup" className={link}>
            List your business
          </Link>
          <Link prefetch={false} href="/login" className={link}>
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
