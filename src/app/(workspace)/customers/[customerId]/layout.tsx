import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerHeader } from "@/components/customers/CustomerHeader";
import { BackLink } from "@/components/ui/BackLink";
import { TabNav } from "@/components/ui/TabNav";
import { customerHref, customerPropertiesHref } from "@/config/routes";
import { getCustomerById, getEquipmentForCustomer } from "@/data/customers";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

export async function generateMetadata({ params }: LayoutProps<"/customers/[customerId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { customerId } = await params;
  const customer = getCustomerById(customerId);
  return { title: customer?.name ?? "Customer" };
}

/** Shared by every customer tab, so the header and tab bar stay mounted while switching tabs. */
export default async function CustomerLayout({ children, params }: LayoutProps<"/customers/[customerId]">) {
  const gate = await fixtureGate("Customers");
  if (gate) return gate;
  const { customerId } = await params;
  const customer = getCustomerById(customerId);
  if (!customer) notFound();

  const equipmentCount = getEquipmentForCustomer(customer.id).length;

  return (
    <>
      <BackLink href="/customers">Back to Customers</BackLink>
      <CustomerHeader customer={customer} />
      <TabNav
        label={`${customer.name} sections`}
        items={[
          { label: "Overview", href: customerHref(customer.id) },
          {
            label: "Properties & equipment",
            href: customerPropertiesHref(customer.id),
            count: `${customer.propertyIds.length} prop · ${equipmentCount} sys`,
          },
        ]}
      />
      {children}
    </>
  );
}
