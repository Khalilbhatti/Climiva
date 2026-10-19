import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import type { PlatformAdmin } from "@/server/platform-admin";
import { PlatformNav } from "./PlatformNav";
import { PlatformSignOut } from "./PlatformSignOut";

/**
 * The frame of Climvia's own control plane: a navigation, who is signed in, and the page. It is deliberately not the workspace's shell: it has no
 * organization switcher, no active business, no Climvia product navigation and no workspace data, because platform authority does not come from a
 * business. It is dense and quiet, an internal tool, not a marketing page.
 */
export function PlatformShell({ admin, children }: { admin: PlatformAdmin; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      <a href="#platform-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-btn focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-primary">
        Skip to main content
      </a>
      <header className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-btn bg-primary text-base font-bold text-white shadow-card">
            C
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight text-ink">Climvia</p>
            <p className="inline-flex items-center gap-1 text-mini font-semibold tracking-wider text-primary uppercase">
              <ShieldCheck aria-hidden className="size-3" />
              Platform
            </p>
          </div>
        </div>
        <PlatformNav />
        <div className="mt-auto hidden border-t border-line px-4 py-4 lg:block">
          <p className="truncate text-sm font-semibold text-ink">{admin.name}</p>
          <p className="truncate text-xs text-ink-muted">{admin.email}</p>
          <p className="mt-1 text-mini font-semibold tracking-wider text-ink-muted uppercase">Super administrator</p>
          <div className="mt-3">
            <PlatformSignOut />
          </div>
        </div>
      </header>
      <main id="platform-main" className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl space-y-6">{children}</div>
        <div className="mx-auto mt-8 max-w-6xl border-t border-line pt-4 lg:hidden">
          <p className="truncate text-sm font-semibold text-ink">{admin.name}</p>
          <p className="truncate text-xs text-ink-muted">{admin.email}</p>
          <div className="mt-3">
            <PlatformSignOut />
          </div>
        </div>
      </main>
    </div>
  );
}
