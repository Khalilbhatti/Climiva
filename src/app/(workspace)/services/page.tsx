import type { Metadata } from "next";
import { Suspense } from "react";
import { ServiceCatalog } from "@/components/services/ServiceCatalog";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  // ServiceCatalog reads the URL (?state=empty) on the client, which needs a Suspense boundary.
  return (
    <Suspense>
      <ServiceCatalog />
    </Suspense>
  );
}
