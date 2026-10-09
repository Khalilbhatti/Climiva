import type { Metadata } from "next";
import { CustomerDirectory } from "@/components/customers/CustomerDirectory";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCustomers } from "@/data/customers";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const gate = await fixtureGate("Customers");
  if (gate) return gate;
  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage customer relationships, service locations and HVAC equipment history."
      />
      <CustomerDirectory customers={getCustomers()} />
    </>
  );
}
