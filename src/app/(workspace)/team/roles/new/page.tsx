import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateRole } from "@/components/team/CreateRole";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Create role" };

export default async function CreateRolePage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  // CreateRole reads ?from= (the Duplicate action), which needs a Suspense boundary.
  return (
    <Suspense>
      <CreateRole />
    </Suspense>
  );
}
