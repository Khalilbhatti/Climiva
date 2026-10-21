"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useMaintenancePlans } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { dueText, visitTitle } from "@/components/maintenance-plans/plan-ui";
import { useOperations } from "@/components/operations/OperationsProvider";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Customer } from "@/data/customers";
import { COVERAGE, getCustomerPlanSummary, getNextVisit, getPlanById, getVisitBooking } from "@/data/maintenance-plans";
import { formatDate } from "@/lib/format";

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

/**
 * The customer's agreement: its terms, what it covers, and its next included visit, which links to the real Booking once the
 * visit is scheduled. All of it is read from the stored plan and Bookings, so it is the same answer the Maintenance Plans pages give.
 */
export function MaintenanceAgreementCard({ customer }: { customer: Customer }) {
  const plan = useCustomerPlan(customer);
  const { data: plans } = useMaintenancePlans();
  const { data: ops } = useOperations();
  if (!plan) return null;

  const stored = plan.planId ? getPlanById(plan.planId, plans) : undefined;
  const next = stored ? getNextVisit(stored, ops) : undefined;
  const booking = next ? getVisitBooking(next, ops) : undefined;

  return (
    <SectionCard title="Maintenance plan" icon={ShieldCheck} action={<StatusBadge tone="positive">{plan.status}</StatusBadge>}>
      <div className="rounded-card bg-surface-low p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-lg font-semibold text-ink">{plan.name}</p>
          {plan.price && <p className="text-lg font-semibold text-ink">{plan.price}</p>}
        </div>
        {plan.visitsPerYear !== undefined && <p className="mt-1 text-sm text-ink-muted">{plan.visitsPerYear} visits included per year</p>}
        {stored && stored.coverage.length > 0 && (
          <p className="mt-1 text-sm text-ink-muted">Coverage: {stored.coverage.map((item) => COVERAGE[item.coverageId].name).join(", ")}</p>
        )}
        {stored && next && (
          <p className="mt-2 text-sm text-ink">
            <span className="font-medium">Next visit:</span> {visitTitle(stored, next)} · {next.label} ·{" "}
            {booking ? (
              <>
                Scheduled {formatDate(booking.date)} (
                <Link href={`/bookings?tab=upcoming&booking=${booking.id}`} className="text-primary hover:underline">
                  Booking #{booking.id}
                </Link>
                )
              </>
            ) : (
              dueText(next)
            )}
          </p>
        )}
        {plan.planId && (
          <Link href={`/maintenance-plans/${plan.planId}`} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">
            View plan
          </Link>
        )}
      </div>
    </SectionCard>
  );
}
