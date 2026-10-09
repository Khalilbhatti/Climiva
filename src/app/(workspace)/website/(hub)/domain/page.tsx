import type { Metadata } from "next";
import { DomainManager } from "@/components/website/DomainManager";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Website domain" };

export default async function WebsiteDomainPage() {
  const gate = await fixtureGate("Website");
  if (gate) return gate;
  return <DomainManager />;
}
