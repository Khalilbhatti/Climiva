import type { Metadata } from "next";
import { Suspense } from "react";
import { ServiceCatalog } from "@/components/services/ServiceCatalog";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  // ServiceCatalog reads the URL (?state=empty) on the client, which needs a Suspense boundary.
  return (
    <Suspense>
      <ServiceCatalog />
    </Suspense>
  );
}
