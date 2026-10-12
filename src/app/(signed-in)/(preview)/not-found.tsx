import { AppShell } from "@/components/shell/AppShell";
import WorkspaceNotFound from "../(workspace)/not-found";

/**
 * A page that does not exist in the signed-in Draft preview. It is rendered inside `(signed-in)/layout.tsx`, which has verified the caller and mounted
 * the workspace's providers, so the shell can be drawn around it.
 */
export default function PreviewNotFound() {
  return (
    <AppShell>
      <WorkspaceNotFound />
    </AppShell>
  );
}
