import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Every workspace module renders inside this one layout, so the shell stays mounted while the user moves
 * between modules. Routes that must NOT show the operator shell (the customer-facing website preview,
 * onboarding) belong outside this route group. The demo data stores are mounted at the app root
 * (components/providers/AppProviders) so those routes can read the same session.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
