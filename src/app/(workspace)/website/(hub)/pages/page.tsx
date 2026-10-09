import type { Metadata } from "next";
import { PagesContent } from "@/components/website/PagesContent";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Website pages" };

export default async function WebsitePagesPage() {
  const gate = await fixtureGate("Website");
  if (gate) return gate;
  return <PagesContent />;
}
