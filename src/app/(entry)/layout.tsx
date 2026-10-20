import type { ReactNode } from "react";

// The front door decides, per request, whether a business member is sent on to their dashboard, so it is never prerendered or cached.
export const dynamic = "force-dynamic";

/**
 * `/`, Climvia's front door. A route group of its own: it is not the workspace (no providers, no shell, no active business), it is not `(public)` (that group
 * reads no session at all, and this page has to ask whether a business member should be sent on to their dashboard), and it is not `(auth)`. It mounts
 * nothing; the page asks `entryDestination()` (src/server/entry.ts) and either redirects or renders the landing, whose HTML is the same for everyone who stays.
 */
export default function EntryLayout({ children }: { children: ReactNode }) {
  return children;
}
