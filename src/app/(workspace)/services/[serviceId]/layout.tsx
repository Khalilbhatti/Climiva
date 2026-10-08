import type { Metadata } from "next";
import { ServiceWorkspace } from "@/components/services/ServiceWorkspace";
import { SERVICES, getServiceById } from "@/data/services";

// The six canonical services are prerendered. Any other id (a service added during a demo session)
// is rendered on demand and resolved against the in-memory catalog on the client.
export function generateStaticParams() {
  return SERVICES.map((service) => ({ serviceId: service.id }));
}

export async function generateMetadata({ params }: LayoutProps<"/services/[serviceId]">): Promise<Metadata> {
  const { serviceId } = await params;
  return { title: getServiceById(serviceId)?.name ?? "Service" };
}

export default async function ServiceLayout({ children, params }: LayoutProps<"/services/[serviceId]">) {
  const { serviceId } = await params;
  return <ServiceWorkspace serviceId={serviceId}>{children}</ServiceWorkspace>;
}
