import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { customerHref } from "@/config/routes";
import { formatPropertyAddress, formatPropertyCityLine, getCustomerById, getPropertyById } from "@/data/customers";
import type { Directory } from "@/data/directory";
import { PLAN_STATUS_LABEL, type MaintenancePlan, type PlanStatus, type PlanVisit } from "@/data/maintenance-plans";
import { getPartyName } from "@/data/operations";
import { formatMonthYear } from "@/lib/format";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

const STATUS_TONE: Record<PlanStatus, StatusTone> = {
  active: "positive",
  pending: "warning",
  paused: "neutral",
  ended: "neutral",
};

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{PLAN_STATUS_LABEL[status]}</StatusBadge>;
}

export const planCustomerName = (plan: MaintenancePlan, dir: Directory) => getPartyName(plan, dir);

/** Street and city line for the plan's property: the Properties record, or the address snapshot. */
export function planProperty(plan: MaintenancePlan, dir: Directory): { street: string; cityLine: string; label?: string } {
  const property = plan.propertyId ? getPropertyById(plan.propertyId, dir) : undefined;
  if (property) return { street: property.street, cityLine: formatPropertyCityLine(property), label: property.label };
  const [street, ...rest] = (plan.propertyText ?? "").split(", ");
  return { street: street || "—", cityLine: rest.join(", ") };
}

export const planFullAddress = (plan: MaintenancePlan, dir: Directory) => {
  const property = plan.propertyId ? getPropertyById(plan.propertyId, dir) : undefined;
  return property ? formatPropertyAddress(property) : (plan.propertyText ?? "");
};

/** The customer's name, linked to their record when they have one. */
export function PlanCustomerName({ plan }: { plan: MaintenancePlan }) {
  const dir = useDirectory();
  const name = planCustomerName(plan, dir);
  return plan.customerId && getCustomerById(plan.customerId, dir) ? (
    <Link href={customerHref(plan.customerId)} className="hover:underline">
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

export const visitTitle = (plan: MaintenancePlan, visit: PlanVisit) => `Visit ${visit.sequence} of ${plan.visitsPerYear}`;


export const dueText = (visit: PlanVisit) => (visit.windowStart ? `Due ${formatMonthYear(visit.windowStart.slice(0, 7))}` : "Available now");
