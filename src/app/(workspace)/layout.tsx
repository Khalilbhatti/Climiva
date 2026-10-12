import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireWorkspaceContext } from "@/server/workspace";

// Everything under here belongs to one signed-in person's active workspace. Never cache it between requests or people.
export const dynamic = "force-dynamic";

/**
 * Every workspace module renders inside this one layout, so the shell stays mounted while the user moves between modules.
 * It requires a signed-in person with a workspace (anyone else is redirected to Log in or to set one up). Routes that
 * must NOT show the operator shell (the customer-facing previews, Log in, setup) belong to other route groups. The
 * providers the shell reads are mounted once at the root (src/app/layout.tsx) so those routes can share the session.
 *
 * This is the first check, not the only one: a layout is not re-run when you move between pages beneath it, so each page
 * that shows workspace content asks again, next to its data (see src/server/workspace.ts and the server actions).
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireWorkspaceContext();
  return <AppShell>{children}</AppShell>;
}
