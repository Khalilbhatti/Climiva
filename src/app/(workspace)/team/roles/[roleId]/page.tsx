import type { Metadata } from "next";
import { RoleDetail } from "@/components/team/RoleDetail";
import { getRoleById } from "@/data/team";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The fixture roles are prerendered; a role created during a demo session is resolved on the client.
export async function generateMetadata({ params }: PageProps<"/team/roles/[roleId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { roleId } = await params;
  return { title: getRoleById(roleId)?.name ?? "Role" };
}

export default async function RolePage({ params }: PageProps<"/team/roles/[roleId]">) {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  const { roleId } = await params;
  return <RoleDetail roleId={roleId} />;
}
