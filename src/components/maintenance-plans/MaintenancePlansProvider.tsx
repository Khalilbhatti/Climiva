"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { PLANS_DATA, type MaintenancePlan, type PlansData } from "@/data/maintenance-plans";
import * as state from "@/lib/maintenance-plans-state";

type PlansContextValue = {
  /** The working data: canonical fixtures plus any demo changes made in this session. */
  data: PlansData;
  createPlan: (input: state.NewPlanInput, customerSlug: string) => MaintenancePlan;
  linkVisitToBooking: (planId: string, visitId: string, bookingId: string) => void;
};

const PlansContext = createContext<PlansContextValue | null>(null);

/**
 * The demo copy of maintenance plans for the whole workspace. It starts as the canonical fixtures, lives only
 * in memory (a reload restores them) and never writes back to data/maintenance-plans.ts. Mounted once at the
 * app root next to the other providers, so Maintenance Plans, Bookings, Schedule and Customers agree.
 */
export function MaintenancePlansProvider({ initial = PLANS_DATA, children }: { initial?: PlansData; children: ReactNode }) {
  const [data, setData] = useState<PlansData>(initial);
  // The ref lets actions that return a value (createPlan) read the latest data synchronously.
  const latest = useRef(data);

  const commit = useCallback((next: PlansData) => {
    latest.current = next;
    setData(next);
  }, []);

  const value = useMemo<PlansContextValue>(
    () => ({
      data,
      createPlan: (input, customerSlug) => {
        const result = state.createPlan(latest.current, input, customerSlug);
        commit(result.data);
        return result.plan;
      },
      linkVisitToBooking: (planId, visitId, bookingId) => commit(state.linkVisitToBooking(latest.current, planId, visitId, bookingId)),
    }),
    [data, commit],
  );

  return <PlansContext value={value}>{children}</PlansContext>;
}

export function useMaintenancePlans(): PlansContextValue {
  const context = useContext(PlansContext);
  if (!context) throw new Error("useMaintenancePlans must be used inside <MaintenancePlansProvider>.");
  return context;
}
