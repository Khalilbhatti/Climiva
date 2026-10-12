import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerHeader } from "@/components/customers/CustomerHeader";
import { BackLink } from "@/components/ui/BackLink";
import { TabNav } from "@/components/ui/TabNav";
import { CustomerBookScope } from "@/components/workspace/DirectoryProvider";
import { customerHref, customerPropertiesHref } from "@/config/routes";
import { getCustomerDetail } from "@/server/core-data";

export async function generateMetadata({ params }: LayoutProps<"/customers/[customerId]">): Promise<Metadata> {
  const { customerId } = await params;
  const detail = await getCustomerDetail(customerId);
  return { title: detail?.customer.name ?? "Customer" };
}

/**
 * Shared by every customer tab, so the header and tab bar stay mounted while switching tabs. The customer is read from
 * PostgreSQL for the active business only: a customer of another business is "not found", exactly like one that never
 * existed. Each tab asks again for itself, since a layout is not re-run when only the tab changes.
 */
export default async function CustomerLayout({ children, params }: LayoutProps<"/customers/[customerId]">) {
  const { customerId } = await params;
  const detail = await getCustomerDetail(customerId);
  if (!detail) notFound();
  const { customer, properties, equipment } = detail;

  return (
    <CustomerBookScope book={{ customers: [customer], properties, equipment }}>
      <BackLink href="/customers">Back to Customers</BackLink>
      <CustomerHeader customer={customer} />
      <TabNav
        label={`${customer.name} sections`}
        items={[
          { label: "Overview", href: customerHref(customer.id) },
          {
            label: "Properties & equipment",
            href: customerPropertiesHref(customer.id),
            count: `${properties.length} prop · ${equipment.length} sys`,
          },
        ]}
      />
      {children}
    </CustomerBookScope>
  );
}
