import type { Metadata } from "next";
import { Users } from "lucide-react";
import { CustomerDirectory } from "@/components/customers/CustomerDirectory";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { CustomerBookScope } from "@/components/workspace/DirectoryProvider";
import { getCustomerBook } from "@/server/core-data";

export const metadata: Metadata = { title: "Customers" };

/** The active business's customers, read from PostgreSQL for this request (and for no other business). */
export default async function CustomersPage() {
  const book = await getCustomerBook();
  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage customer relationships, service locations and HVAC equipment history."
      />
      {book.customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Customers you serve will appear here, with their service locations and equipment."
        />
      ) : (
        <CustomerBookScope book={book}>
          <CustomerDirectory customers={book.customers} />
        </CustomerBookScope>
      )}
    </>
  );
}
