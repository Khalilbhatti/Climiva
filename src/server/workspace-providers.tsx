import "server-only";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { getCoreSnapshot } from "./core-data";
import { requireWorkspaceContext } from "./workspace";

/**
 * The signed-in workspace's providers: the verified person, their workspaces, the active business's settings and its core data (Services,
 * team, customers, operations, financials, the Website's Draft and Published snapshot, the Marketplace listing, the reporting figures).
 *
 * This is the ONLY place that reads that data for a page and hands it to the browser, and it is mounted by exactly two things:
 *
 *   - the signed-in side of the application (`app/(signed-in)/layout.tsx`), which holds the workspace (inside the shell) and the signed-in Draft
 *     previews (the business's own, no shell), so moving between them keeps the providers mounted;
 *   - the "not found" page of an address that matches no route, for someone signed in (`app/(unmatched)/not-found.tsx`).
 *
 * The root layout does not mount it, and neither does anything under `app/(public)` (the published Sites and Marketplace listings) or
 * `app/(auth)`: whether someone happens to be signed in changes nothing about what a public page loads or sends. A test holds the
 * boundary in the source (no route or component reachable from a public page imports this file, a provider or the workspace's data access)
 * and at run time (a server whose database role can only run the three public functions still serves every public page, for a visitor and
 * for a signed-in member of any business alike).
 *
 * It verifies the workspace itself (a redirect to Log in or to set one up), so a route that mounts it is never reachable without one. It is
 * keyed by the business, so switching business (always a full page load) can never leave one business's state in front of another.
 */
export async function WorkspaceProviders({ children }: { children: ReactNode }) {
  const context = await requireWorkspaceContext();
  const core = await getCoreSnapshot();
  if (!core) throw new Error("The workspace was verified but its data could not be read.");
  return (
    <AppProviders key={context.snapshot.organization.id} snapshot={context.snapshot} core={core}>
      {children}
    </AppProviders>
  );
}
