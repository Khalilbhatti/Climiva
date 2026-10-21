import { notFound } from "next/navigation";
import { Home } from "lucide-react";
import { PropertySection } from "@/components/customers/PropertySection";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCustomerDetail } from "@/server/core-data";

export default async function CustomerPropertiesPage({ params }: PageProps<"/customers/[customerId]/properties">) {
  const { customerId } = await params;
  const detail = await getCustomerDetail(customerId);
  if (!detail) notFound();
  const { customer, properties } = detail;

  if (properties.length === 0) {
    return <EmptyState icon={Home} title="No service locations yet" description="The places this customer is served, and the equipment installed there, will appear here." />;
  }

  return (
    <div className="space-y-6">
      {properties.map((property) => (
        <PropertySection key={property.id} property={property} primary={property.id === customer.propertyIds[0]} />
      ))}
    </div>
  );
}
