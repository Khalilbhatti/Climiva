import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamList } from "@/components/team/TeamList";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  // TeamList keeps the Add team member flow in the URL (?add=1), which needs a Suspense boundary.
  return (
    <Suspense>
      <TeamList />
    </Suspense>
  );
}
