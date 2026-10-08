import type { Metadata } from "next";
import { RoleDetail } from "@/components/team/RoleDetail";
import { ROLES, getRoleById } from "@/data/team";

// The fixture roles are prerendered; a role created during a demo session is resolved on the client.
export function generateStaticParams() {
  return ROLES.map((role) => ({ roleId: role.id }));
}

export async function generateMetadata({ params }: PageProps<"/team/roles/[roleId]">): Promise<Metadata> {
  const { roleId } = await params;
  return { title: getRoleById(roleId)?.name ?? "Role" };
}

export default async function RolePage({ params }: PageProps<"/team/roles/[roleId]">) {
  const { roleId } = await params;
  return <RoleDetail roleId={roleId} />;
}
