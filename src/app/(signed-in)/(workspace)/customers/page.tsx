import type { Metadata } from "next";
import { Users } from "lucide-react";
import { AddCustomerButton } from "@/components/customers/AddCustomerButton";
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
        description="People your business serves, and their service history."
        // The empty state carries its own primary action, so the header one waits for the first customer.
        actions={book.customers.length > 0 && <AddCustomerButton />}
      />
      {book.customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Add the people you serve. A customer is also added when someone books on your website or Marketplace profile."
          action={<AddCustomerButton fallback={<p className="text-sm text-ink-muted">Only an owner or admin can add customers.</p>} />}
        />
      ) : (
        <CustomerBookScope book={book}>
          <CustomerDirectory customers={book.customers} />
        </CustomerBookScope>
      )}
    </>
  );
}
