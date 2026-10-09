import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { resolveWorkspace } from "@/server/workspace";
import WorkspaceNotFound from "./(workspace)/not-found";

/**
 * A URL that matches no route at all. Someone signed in to a workspace gets the "couldn't find that page" state inside
 * that workspace's shell (the root layout has mounted its providers); anyone else gets a plain page that reveals nothing
 * about any workspace.
 */
export default async function NotFound() {
  const state = await resolveWorkspace();
  if (state.status === "ready") {
    return (
      <AppShell>
        <WorkspaceNotFound />
      </AppShell>
    );
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <h1 className="text-xl font-bold text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">The link may be incorrect.</p>
      <Link href="/" className="mt-5 text-sm font-semibold text-primary hover:underline">
        Go to Climvia
      </Link>
    </main>
  );
}
