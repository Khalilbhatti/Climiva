import { notFound } from "next/navigation";
import { PropertySection } from "@/components/customers/PropertySection";
import { getCustomerDetail } from "@/server/core-data";

export default async function CustomerPropertiesPage({ params }: PageProps<"/customers/[customerId]/properties">) {
  const { customerId } = await params;
  const detail = await getCustomerDetail(customerId);
  if (!detail) notFound();
  const { customer, properties } = detail;

  return (
    <div className="space-y-6">
      {properties.map((property) => (
        <PropertySection key={property.id} property={property} primary={property.id === customer.propertyIds[0]} />
      ))}
    </div>
  );
}
