import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamList } from "@/components/team/TeamList";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  // TeamList keeps the Add team member flow in the URL (?add=1), which needs a Suspense boundary.
  return (
    <Suspense>
      <TeamList />
    </Suspense>
  );
}
