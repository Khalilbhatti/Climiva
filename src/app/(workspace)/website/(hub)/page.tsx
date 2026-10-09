import type { Metadata } from "next";
import { Suspense } from "react";
import { WebsiteOverview } from "@/components/website/WebsiteOverview";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Website" };

export default async function WebsitePage() {
  const gate = await fixtureGate("Website");
  if (gate) return gate;
  // ?state=empty previews the "no website yet" state, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <WebsiteOverview />
    </Suspense>
  );
}
