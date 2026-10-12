import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Every workspace module renders inside this one layout, so the shell stays mounted while the user moves between modules. The providers it (and every
 * module) reads, and the verification of the signed-in person's workspace, come from the layout above (`(signed-in)/layout.tsx`). Routes that must
 * NOT show the operator shell are elsewhere: the signed-in Draft previews (`(preview)`, beside this group), the published Sites and listings
 * (`(public)`, no providers at all), and Log in, Sign up and set-up (`(auth)`).
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
