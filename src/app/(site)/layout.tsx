import type { ReactNode } from "react";
import { PublicUnavailable } from "@/components/workspace/ModuleUnavailable";
import { resolveWorkspace } from "@/server/workspace";

export const dynamic = "force-dynamic";

/**
 * The customer-facing Website and Marketplace previews. They are outside the workspace shell and are NOT behind a login
 * redirect (they will be public pages), but until sites are published per business they preview the active workspace
 * for someone signed in to it, and show "isn't available" to everyone else: never another business's content. The
 * providers they read are the root ones, built from the same verified workspace.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const state = await resolveWorkspace();
  if (state.status !== "ready" || !state.context.snapshot.hasSampleData) return <PublicUnavailable />;
  return children;
}
