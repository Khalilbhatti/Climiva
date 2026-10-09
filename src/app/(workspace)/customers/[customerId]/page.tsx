import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Home, Lock, ShieldCheck, StickyNote } from "lucide-react";
import { DisplayDate } from "@/components/ui/DisplayDate";
import { SectionCard } from "@/components/ui/SectionCard";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { MaintenanceAgreementCard } from "@/components/customers/CustomerPlan";
import { CurrentServiceCard, RecentVisitsCard } from "@/components/customers/CustomerWork";
import { EquipmentCard } from "@/components/customers/EquipmentCard";
import { customerPropertiesHref } from "@/config/routes";
import {
  formatPropertyCityLine,
  getCustomerById,
  getEquipmentForCustomer,
  getPropertiesForCustomer,
} from "@/data/customers";
import { fixtureGate } from "@/server/fixture-gate";

const linkClasses = "inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline";

export default async function CustomerOverviewPage({ params }: PageProps<"/customers/[customerId]">) {
  const gate = await fixtureGate("Customers");
  if (gate) return gate;
  const { customerId } = await params;
  const customer = getCustomerById(customerId);
  if (!customer) notFound();

  const properties = getPropertiesForCustomer(customer.id);
  const equipment = getEquipmentForCustomer(customer.id);
  const propertiesHref = customerPropertiesHref(customer.id);
  const showNotes = customer.notes.length > 0 || customer.preferences.length > 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        <CurrentServiceCard customerId={customer.id} />

        <SectionCard
          title={`Service properties (${properties.length})`}
          icon={Home}
          action={
            <Link href={propertiesHref} className={linkClasses}>
              View property details &amp; equipment
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          }
        >
          <ul className="space-y-3">
            {properties.map((property) => (
              <li key={property.id} className="rounded-card bg-surface-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-lg font-semibold text-ink">
                      {property.street}
                      <span className="rounded bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                        {property.label}
                      </span>
                    </p>
                    <p className="text-sm text-ink-muted">{formatPropertyCityLine(property)}</p>
                  </div>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink-muted">
                    {getEquipmentForCustomer(customer.id).filter((item) => item.propertyId === property.id).length} systems
                  </span>
                </div>
                {property.accessInstructions && (
                  <div className="mt-3 rounded-btn bg-surface p-3">
                    <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Access &amp; gate instructions</p>
                    <p className="mt-0.5 text-sm text-ink">{property.accessInstructions}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="HVAC equipment snapshot"
          icon={ShieldCheck}
          action={
            equipment.length > 0 && (
              <Link href={propertiesHref} className={linkClasses}>
                View equipment ({equipment.length})
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            )
          }
        >
          {equipment.length === 0 ? (
            <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No equipment is on record yet.</p>
          ) : (
            <div className="space-y-3">
              {equipment.map((item) => (
                <EquipmentCard key={item.id} equipment={item} variant="summary" />
              ))}
            </div>
          )}
        </SectionCard>

        <RecentVisitsCard customerId={customer.id} />
      </div>

      <div className="space-y-6 lg:col-span-5">
        <SectionCard title="Customer contact">
          <KeyValueList
            items={[
              { label: "Phone", value: customer.phone },
              { label: "Email", value: customer.email },
              { label: "Preferred contact", value: customer.preferredContact },
              ...(customer.language ? [{ label: "Language", value: customer.language }] : []),
            ]}
          />
        </SectionCard>

        {showNotes && (
          <SectionCard title="Customer notes" icon={StickyNote}>
            <div className="space-y-4">
              {customer.notes.map((note) => (
                <div key={note.updatedOn} className="rounded-card bg-surface-low p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1.5 rounded bg-surface px-2 py-1 font-semibold">
                      <Lock aria-hidden className="size-3" />
                      Internal notes (private / internal only)
                    </span>
                    <span>
                      Updated <DisplayDate value={note.updatedOn} />
                    </span>
                  </div>
                  <p className="text-sm text-ink">{note.body}</p>
                  <p className="mt-2 text-xs text-ink-muted">Recorded by: {note.recordedBy}</p>
                </div>
              ))}
              {customer.preferences.length > 0 && (
                <div className="rounded-card bg-surface-low p-4">
                  <h3 className="mb-2 text-xs font-semibold text-ink-muted">Customer preferences</h3>
                  <ul className="space-y-1.5 text-sm text-ink">
                    {customer.preferences.map((preference) => (
                      <li key={preference} className="flex items-center gap-2">
                        <Check aria-hidden className="size-4 text-positive" />
                        {preference}
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <Check aria-hidden className="size-4 text-positive" />
                      Preferred contact channel: {customer.preferredContact}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        <MaintenanceAgreementCard customer={customer} />
      </div>
    </div>
  );
}
