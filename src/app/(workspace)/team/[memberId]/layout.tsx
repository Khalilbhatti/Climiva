import type { Metadata } from "next";
import { MemberWorkspace } from "@/components/team/MemberWorkspace";
import { TEAM, getTeamMemberById } from "@/data/team";

// The fixture members are prerendered. Any other id (someone invited during a demo session) is rendered on
// demand and resolved against the in-memory Team data on the client.
export function generateStaticParams() {
  return TEAM.map((member) => ({ memberId: member.id }));
}

export async function generateMetadata({ params }: LayoutProps<"/team/[memberId]">): Promise<Metadata> {
  const { memberId } = await params;
  return { title: getTeamMemberById(memberId)?.name ?? "Team member" };
}

export default async function MemberLayout({ children, params }: LayoutProps<"/team/[memberId]">) {
  const { memberId } = await params;
  return <MemberWorkspace memberId={memberId}>{children}</MemberWorkspace>;
}
