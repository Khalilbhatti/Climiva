import { notFound } from "next/navigation";
import { PropertySection } from "@/components/customers/PropertySection";
import { getCustomerById, getPropertiesForCustomer } from "@/data/customers";
import { fixtureGate } from "@/server/fixture-gate";

export default async function CustomerPropertiesPage({ params }: PageProps<"/customers/[customerId]/properties">) {
  const gate = await fixtureGate("Customers");
  if (gate) return gate;
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
