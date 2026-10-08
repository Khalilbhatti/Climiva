import { notFound } from "next/navigation";
import { PropertySection } from "@/components/customers/PropertySection";
import { getCustomerById, getPropertiesForCustomer } from "@/data/customers";

export default async function CustomerPropertiesPage({ params }: PageProps<"/customers/[customerId]/properties">) {
  const { customerId } = await params;
  const customer = getCustomerById(customerId);
  if (!customer) notFound();

  const properties = getPropertiesForCustomer(customer.id);

  return (
    <div className="space-y-6">
      {properties.map((property) => (
        <PropertySection key={property.id} property={property} primary={property.id === customer.propertyIds[0]} />
      ))}
    </div>
  );
}
