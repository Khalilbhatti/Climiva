import type { Metadata } from "next";
import { Suspense } from "react";
import { ServiceCatalog } from "@/components/services/ServiceCatalog";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  // The Services are the active business's own, read from PostgreSQL when the workspace loaded (see the root layout); this
  // is the authentication check that sits next to them.
  await requireWorkspaceContext();
  // ServiceCatalog reads the URL (?state=empty) on the client, which needs a Suspense boundary.
  return (
    <Suspense>
      <ServiceCatalog />
    </Suspense>
  );
}
