import { KeyRound, MapPin, Wrench } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import { EquipmentCard } from "./EquipmentCard";
import { formatPropertyCityLine, getEquipmentForProperty, type Property } from "@/data/customers";

/** One property with its access notes and registered equipment (the Properties & equipment tab). */
export function PropertySection({ property, primary }: { property: Property; primary: boolean }) {
  const equipment = getEquipmentForProperty(property.id);

  return (
    <section aria-labelledby={`${property.id}-heading`} className={`${cardClasses("lg")} space-y-5`}>
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-primary text-white">
          <MapPin aria-hidden className="size-6" />
        </span>
        <div>
          <div className="mb-1 flex items-center gap-2 text-micro font-bold tracking-wider uppercase">
            <span className="rounded bg-primary-subtle px-2 py-0.5 text-primary">{property.label}</span>
            {primary && <span className="rounded bg-surface-low px-2 py-0.5 text-ink-muted">Primary property</span>}
          </div>
          <h2 id={`${property.id}-heading`} className="text-xl font-bold tracking-tight text-ink">
            {property.street}, {formatPropertyCityLine(property)}
          </h2>
        </div>
      </div>

      {(property.accessInstructions || property.mechanicalAccess) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {property.accessInstructions && (
            <div className="rounded-card bg-surface-low p-4">
              <h3 className="mb-2 flex items-center gap-2 font-semibold text-ink">
                <KeyRound aria-hidden className="size-4 text-primary" />
                Access &amp; security
              </h3>
              <p className="text-sm text-ink-muted">{property.accessInstructions}</p>
            </div>
          )}
          {property.mechanicalAccess && (
            <div className="rounded-card bg-surface-low p-4">
              <h3 className="mb-2 flex items-center gap-2 font-semibold text-ink">
                <Wrench aria-hidden className="size-4 text-primary" />
                Service &amp; mechanical access
              </h3>
              <p className="text-sm text-ink-muted">{property.mechanicalAccess}</p>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          Registered HVAC equipment
          <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">
            {equipment.length} installed {equipment.length === 1 ? "unit" : "units"}
          </span>
        </h3>
        {equipment.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
            No equipment is on record for this property yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {equipment.map((item) => (
              <EquipmentCard key={item.id} equipment={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
