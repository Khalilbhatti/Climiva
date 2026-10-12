import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoleDetail } from "@/components/team/RoleDetail";
import { getTeam } from "@/server/core-data";

export async function generateMetadata({ params }: PageProps<"/team/roles/[roleId]">): Promise<Metadata> {
  const { roleId } = await params;
  const team = await getTeam();
  return { title: team.roles.find((role) => role.id === roleId)?.name ?? "Role" };
}

export default async function RolePage({ params }: PageProps<"/team/roles/[roleId]">) {
  const { roleId } = await params;
  const team = await getTeam();
  if (!team.roles.some((role) => role.id === roleId)) notFound();
  return <RoleDetail roleId={roleId} />;
}
