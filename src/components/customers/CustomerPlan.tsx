"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useMaintenancePlans } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Customer } from "@/data/customers";
import { getCustomerPlanSummary } from "@/data/maintenance-plans";

/** The customer's plan, read from the Maintenance Plans records (so a plan created this session shows up here). */
export function useCustomerPlan(customer: Pick<Customer, "id" | "maintenancePlan">) {
  const { data } = useMaintenancePlans();
  return getCustomerPlanSummary(customer, data);
}

/** The plan's name as a badge in the Customers list. */
export function PlanBadge({ customer }: { customer: Customer }) {
  const plan = useCustomerPlan(customer);
  return plan ? <StatusBadge tone="positive">{plan.name}</StatusBadge> : <span className="text-xs text-ink-muted">No plan</span>;
}

/** "Comfort Care (Active)" for the customer header tile. */
export function PlanStatusText({ customer }: { customer: Customer }) {
  const plan = useCustomerPlan(customer);
  return <>{plan ? `${plan.name} (${plan.status})` : "No maintenance plan"}</>;
}

export function MaintenanceAgreementCard({ customer }: { customer: Customer }) {
  const plan = useCustomerPlan(customer);
  if (!plan) return null;

  return (
    <SectionCard title="Maintenance agreement" icon={ShieldCheck} action={<StatusBadge tone="positive">{plan.status}</StatusBadge>}>
      <div className="rounded-card bg-surface-low p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-lg font-semibold text-ink">{plan.name}</p>
          {plan.price && <p className="text-lg font-semibold text-ink">{plan.price}</p>}
        </div>
        {plan.visitsPerYear !== undefined && <p className="mt-1 text-sm text-ink-muted">{plan.visitsPerYear} visits included per year</p>}
        {plan.planId && (
          <Link href={`/maintenance-plans/${plan.planId}`} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">
            View plan
          </Link>
        )}
      </div>
    </SectionCard>
  );
}
