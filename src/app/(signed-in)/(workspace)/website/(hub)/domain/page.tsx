import type { Metadata } from "next";
import { DomainManager } from "@/components/website/DomainManager";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Website domain" };

export default async function WebsiteDomainPage() {
  await requireWorkspaceContext();
  return <DomainManager />;
}
