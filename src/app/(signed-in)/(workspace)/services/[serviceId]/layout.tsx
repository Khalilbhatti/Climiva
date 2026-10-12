import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServiceWorkspace } from "@/components/services/ServiceWorkspace";
import { getServices } from "@/server/core-data";

export async function generateMetadata({ params }: LayoutProps<"/services/[serviceId]">): Promise<Metadata> {
  const { serviceId } = await params;
  const services = await getServices();
  return { title: services.find((service) => service.id === serviceId)?.name ?? "Service" };
}

/**
 * A Service of the active business, found by its slug. A slug that belongs to another business, or to nothing, is "not
 * found": the lookup only ever sees this business's rows.
 */
export default async function ServiceLayout({ children, params }: LayoutProps<"/services/[serviceId]">) {
  const { serviceId } = await params;
  const services = await getServices();
  if (!services.some((service) => service.id === serviceId)) notFound();
  return <ServiceWorkspace serviceId={serviceId}>{children}</ServiceWorkspace>;
}
