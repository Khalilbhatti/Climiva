"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useOperations } from "@/components/operations/OperationsProvider";
import type { CoverageId, MaintenancePlan, PlanCadence, PlansData } from "@/data/maintenance-plans";
import type { Booking, OperationsData } from "@/data/operations";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { createPlanAction, scheduleVisitAction } from "@/server/actions/maintenance";

export type NewPlanInput = {
  customerId: string;
  propertyId: string;
  name: string;
  status: "active" | "pending";
  /** Visits per year of each kind of coverage. */
  coverage: Partial<Record<CoverageId, number>>;
  /** What the person typed ("189", "189.50"): read as exact cents on the server. */
  price: string;
  cadence: PlanCadence;
  startDate: string;
  endDate?: string;
  note?: string;
};

export type ScheduleVisitInput = {
  serviceId: string;
  date: string;
  start: string;
  end: string;
  assigneeId?: string;
  internalNotes?: string;
};

type PlansContextValue = {
  /** The business's plans, as stored. A visit's state is derived from its Booking by the selectors in data/maintenance-plans. */
  data: PlansData;
  /** Creates a plan with its coverage and visits. It creates no Booking, Job, Invoice or Payment. */
  createPlan: (input: NewPlanInput) => Promise<ActionResult<{ plans: PlansData; plan: MaintenancePlan }>>;
  /** Schedules a plan's next included visit as a real Booking, atomically. */
  scheduleVisit: (planId: string, visitId: string, input: ScheduleVisitInput) => Promise<ActionResult<{ plans: PlansData; operations: OperationsData; booking: Booking }>>;
};

const PlansContext = createContext<PlansContextValue | null>(null);

/**
 * The business's Maintenance Plans for the whole workspace. `initial` is what the server read from PostgreSQL for this page load,
 * for the ACTIVE organization only. Every change goes to the server, which authorizes it (owner or admin), validates it, stores it
 * in one transaction and answers with the plans as stored; only then does the working copy change, so the screen is never ahead
 * of the database. Scheduling a visit makes a real Booking too, so the answer carries the operations and the Bookings and
 * Schedule adopt them in the same step. Mounted once at the app root next to the other providers, so Maintenance Plans,
 * Bookings, Schedule and Customers agree.
 */
export function MaintenancePlansProvider({ initial, children }: { initial: PlansData; children: ReactNode }) {
  const [data, setData] = useState<PlansData>(initial);
  const { adoptOperations } = useOperations();

  const adopt = useCallback(<T extends { plans: PlansData }>(result: ActionResult<T>): ActionResult<T> => {
    if (result.ok) setData(result.data.plans);
    return result;
  }, []);

  const value = useMemo<PlansContextValue>(
    () => ({
      data,
      createPlan: async (input) => adopt(await send(() => createPlanAction(input))),
      scheduleVisit: async (planId, visitId, input) => {
        const result = adopt(await send(() => scheduleVisitAction(planId, visitId, input)));
        if (result.ok) adoptOperations(result.data.operations);
        return result;
      },
    }),
    [data, adopt, adoptOperations],
  );

  return <PlansContext value={value}>{children}</PlansContext>;
}

export function useMaintenancePlans(): PlansContextValue {
  const context = useContext(PlansContext);
  if (!context) throw new Error("useMaintenancePlans must be used inside <MaintenancePlansProvider>.");
  return context;
}
