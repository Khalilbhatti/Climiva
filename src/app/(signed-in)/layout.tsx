import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WorkspaceProviders } from "@/server/workspace-providers";

// A business's workspace and the previews of its Drafts are private, and nothing under here is ever indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Everything under here belongs to one signed-in person's active workspace. Never cache it between requests or people.
export const dynamic = "force-dynamic";

/**
 * The signed-in side of the application: the workspace (`(workspace)`, inside the operator shell) and the signed-in Draft previews
 * (`(preview)`, no shell). They share THIS layout, so the providers stay mounted, with whatever a person has set this visit (the session-only
 * branding, for example), when they move between a module and a preview. `WorkspaceProviders` verifies the signed-in person and their workspace
 * (anyone else is redirected to Log in or to set one up), reads the workspace's data on the server and mounts the providers.
 *
 * Nothing outside this group mounts them: the published Sites and listings (`(public)`) read no session and carry no workspace, Log in, Sign up and
 * set-up (`(auth)`) need none, and the root layout is only the document. See src/server/workspace-providers.tsx.
 *
 * This is the first check, not the only one: a layout is not re-run when you move between pages beneath it, so each page that shows workspace content
 * asks again, next to its data (see src/server/workspace.ts and the server actions).
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
