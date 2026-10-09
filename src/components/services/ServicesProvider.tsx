"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Service } from "@/data/services";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { addServiceAction, updateServiceAction } from "@/server/actions/services";
import { withAddedService, withUpdatedService } from "./service-state";

type ServicesContextValue = {
  /** The business's Services, as stored. */
  services: readonly Service[];
  /** Create a Service. Resolves with the Service as stored (the server chooses its id), or with why it was refused. */
  addService: (service: Service) => Promise<ActionResult<Service>>;
  /** Save every field of one Service. Resolves with the Service as stored. */
  updateService: (service: Service) => Promise<ActionResult<Service>>;
};

const ServicesContext = createContext<ServicesContextValue | null>(null);

/**
 * The business's Services. `initial` is what the server read from PostgreSQL for this page load; a change goes to the server,
 * which authorizes and validates it again and stores it, and only when that succeeds does the working copy change, so what
 * is on screen is never ahead of what is stored. Mounted around the whole workspace (the Bookings, Schedule and Website
 * pickers read it too).
 */
export function ServicesProvider({ initial, children }: { initial: readonly Service[]; children: ReactNode }) {
  const [services, setServices] = useState<readonly Service[]>(initial);

  const addService = useCallback(async (service: Service) => {
    const result = await send(() => addServiceAction(service));
    if (result.ok) setServices((current) => withAddedService(current, result.data));
    return result;
  }, []);

  const updateService = useCallback(async (service: Service) => {
    const result = await send(() => updateServiceAction(service.id, service));
    if (result.ok) setServices((current) => withUpdatedService(current, result.data));
    return result;
  }, []);

  const value = useMemo(() => ({ services, addService, updateService }), [services, addService, updateService]);
  return <ServicesContext value={value}>{children}</ServicesContext>;
}

export function useServices(): ServicesContextValue {
  const context = useContext(ServicesContext);
  if (!context) throw new Error("useServices must be used inside <ServicesProvider>.");
  return context;
}
