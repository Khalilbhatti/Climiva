import type { Metadata } from "next";
import { RolesList } from "@/components/team/RolesList";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  return <RolesList />;
}
