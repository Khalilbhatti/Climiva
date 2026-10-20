import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { OnboardingFlow } from "@/components/auth/OnboardingFlow";
import { requireUser } from "@/server/session";
import { resolveWorkspace } from "@/server/workspace";

export const metadata: Metadata = { title: "Set up your business" };
export const dynamic = "force-dynamic";

/**
 * Where a person with no workspace lands, and where someone who already has one goes to add another (?new=1).
 * Someone who already has a workspace and did not ask for another is sent on to it.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUser();
  const { new: addAnother } = await searchParams;
  const state = await resolveWorkspace();
  const hasWorkspace = state.status === "ready";
  if (hasWorkspace && addAnother !== "1") redirect("/overview");

  return (
    <AuthShell
      wide
      title="Set up your business"
      description={hasWorkspace ? "Add another business workspace. Your other workspaces stay as they are." : "A few details to create your workspace. You can change all of this later in Settings."}
    >
      <OnboardingFlow cancelHref={hasWorkspace ? "/overview" : undefined} />
    </AuthShell>
  );
}
