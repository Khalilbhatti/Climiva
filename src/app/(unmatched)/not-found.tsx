import { AppShell } from "@/components/shell/AppShell";
import { PlainNotFound } from "@/components/shell/PlainNotFound";
import { resolveWorkspace } from "@/server/workspace";
import { WorkspaceProviders } from "@/server/workspace-providers";
import WorkspaceNotFound from "../(signed-in)/(workspace)/not-found";

/**
 * A URL that matches no route at all. Someone signed in to a workspace gets the "couldn't find that page" state inside that workspace's shell,
 * with the providers the shell reads mounted here; anyone else gets a plain page that reveals nothing about any workspace. This boundary belongs
 * to the catch-all page next to it and nothing else, so it is sent with no other response: a published Site, a listing, the workspace and Log in
 * never carry it. (The addresses under /sites and /listings that name nothing have their own plain pages in `(public)`.)
 */
export default async function UnmatchedNotFound() {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return <PlainNotFound />;
  return (
    <WorkspaceProviders>
      <AppShell>
        <WorkspaceNotFound />
      </AppShell>
    </WorkspaceProviders>
  );
}
