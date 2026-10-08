import type { Metadata } from "next";
import { CustomerDirectory } from "@/components/customers/CustomerDirectory";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCustomers } from "@/data/customers";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
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
