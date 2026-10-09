import type { Metadata } from "next";
import { MemberWorkspace } from "@/components/team/MemberWorkspace";
import { getTeamMemberById } from "@/data/team";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The fixture members are prerendered. Any other id (someone invited during a demo session) is rendered on
// demand and resolved against the in-memory Team data on the client.
export async function generateMetadata({ params }: LayoutProps<"/team/[memberId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { memberId } = await params;
  return { title: getTeamMemberById(memberId)?.name ?? "Team member" };
}

export default async function MemberLayout({ children, params }: LayoutProps<"/team/[memberId]">) {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  const { memberId } = await params;
  return <MemberWorkspace memberId={memberId}>{children}</MemberWorkspace>;
}
