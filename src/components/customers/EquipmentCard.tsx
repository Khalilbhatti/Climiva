import { Fan, Thermometer } from "lucide-react";
import { DisplayDate } from "@/components/ui/DisplayDate";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getServiceById } from "@/data/services";
import type { Equipment } from "@/data/customers";
import { formatMonthYear } from "@/lib/format";

/**
 * A registered piece of equipment. A record of what is installed, never live status.
 * "summary" is the compact form used in the Overview snapshot; "full" adds location, filter and service notes.
 */
export function EquipmentCard({ equipment, variant = "full" }: { equipment: Equipment; variant?: "full" | "summary" }) {
  const Icon = equipment.kind.toLowerCase().includes("thermostat") ? Thermometer : Fan;
  const last = equipment.lastServiced;
  const lastService = last?.serviceId ? getServiceById(last.serviceId)?.name : undefined;

  const identity = [
    { label: "Manufacturer & model", value: `${equipment.manufacturer} ${equipment.model}` },
    { label: "Model code", value: <span className="font-mono text-xs">{equipment.modelCode}</span> },
    { label: "Serial number", value: <span className="font-mono text-xs">{equipment.serialNumber}</span> },
  ];
  const details = [
    { label: "Location", value: equipment.location },
    { label: "In service since", value: formatMonthYear(equipment.inServiceSince) },
    ...(equipment.refrigerant ? [{ label: "Refrigerant", value: equipment.refrigerant }] : []),
    ...(equipment.filter ? [{ label: "Filter requirement", value: equipment.filter }] : []),
  ];

  return (
    <article aria-label={equipment.name} className="space-y-4 rounded-card border border-line bg-canvas p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-primary text-white">
            <Icon aria-hidden className="size-5" />
          </span>
          <div>
            <h3 className="font-semibold text-ink">{equipment.name}</h3>
            <p className="text-xs text-ink-muted">
              {equipment.kind}
              {equipment.capacity && ` · ${equipment.capacity}`}
            </p>
          </div>
        </div>
        <StatusBadge tone="positive">{equipment.status}</StatusBadge>
      </div>

      <KeyValueList
        items={variant === "summary" ? [...identity, { label: "In service since", value: formatMonthYear(equipment.inServiceSince) }] : identity}
        className="rounded-btn border border-line bg-surface p-3"
      />
      {variant === "full" && <KeyValueList items={details} layout="tiles" />}

      {variant === "full" && last && (
        <div className="rounded-btn border border-line bg-surface p-3 text-sm">
          <p className="text-xs font-semibold text-ink-muted">
            Last serviced: <DisplayDate value={last.date} />
            {lastService && ` · ${lastService}`}
            {last.jobId && ` · Job #${last.jobId}`}
          </p>
          {last.note && <p className="mt-1 text-ink">{last.note}</p>}
        </div>
      )}
    </article>
  );
}
