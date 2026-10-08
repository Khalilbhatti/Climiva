import { AppShell } from "@/components/shell/AppShell";
import WorkspaceNotFound from "./(workspace)/not-found";

/** A URL that matches no route at all gets the same "couldn't find that page" state, inside the workspace shell. */
export default function NotFound() {
  return (
    <AppShell>
      <WorkspaceNotFound />
    </AppShell>
  );
}
