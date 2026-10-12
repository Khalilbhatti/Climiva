import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberWorkspace } from "@/components/team/MemberWorkspace";
import { getTeam } from "@/server/core-data";

export async function generateMetadata({ params }: LayoutProps<"/team/[memberId]">): Promise<Metadata> {
  const { memberId } = await params;
  const team = await getTeam();
  return { title: team.members.find((member) => member.id === memberId)?.name ?? "Team member" };
}

/**
 * A member of the active business's team, found by their slug. A slug that belongs to another business's team, or to
 * nobody, is "not found": the lookup only ever sees this business's rows.
 */
export default async function MemberLayout({ children, params }: LayoutProps<"/team/[memberId]">) {
  const { memberId } = await params;
  const team = await getTeam();
  if (!team.members.some((member) => member.id === memberId)) notFound();
  return <MemberWorkspace memberId={memberId}>{children}</MemberWorkspace>;
}
