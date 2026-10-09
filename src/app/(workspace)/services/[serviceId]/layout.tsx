import type { Metadata } from "next";
import { ServiceWorkspace } from "@/components/services/ServiceWorkspace";
import { getServiceById } from "@/data/services";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The six canonical services are prerendered. Any other id (a service added during a demo session)
// is rendered on demand and resolved against the in-memory catalog on the client.
export async function generateMetadata({ params }: LayoutProps<"/services/[serviceId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { serviceId } = await params;
  return { title: getServiceById(serviceId)?.name ?? "Service" };
}

export default async function ServiceLayout({ children, params }: LayoutProps<"/services/[serviceId]">) {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  const { serviceId } = await params;
  return <ServiceWorkspace serviceId={serviceId}>{children}</ServiceWorkspace>;
}
