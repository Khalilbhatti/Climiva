"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { SERVICES, type Service } from "@/data/services";
import { withAddedService, withUpdatedService } from "./service-state";

type ServicesContextValue = {
  /** The working catalog: canonical fixtures plus any demo edits made in this session. */
  services: readonly Service[];
  addService: (service: Service) => void;
  updateService: (service: Service) => void;
};

const ServicesContext = createContext<ServicesContextValue | null>(null);

/**
 * Holds the demo catalog for the Services module. It starts as a copy of the canonical fixtures,
 * lives only in memory (a reload restores the six canonical services), and never writes back to
 * data/services.ts. Mounted in app/(workspace)/services/layout.tsx so list and detail share it.
 */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<readonly Service[]>(SERVICES);

  const addService = useCallback((service: Service) => setServices((current) => withAddedService(current, service)), []);
  const updateService = useCallback(
    (service: Service) => setServices((current) => withUpdatedService(current, service)),
    [],
  );

  const value = useMemo(() => ({ services, addService, updateService }), [services, addService, updateService]);
  return <ServicesContext value={value}>{children}</ServicesContext>;
}

export function useServices(): ServicesContextValue {
  const context = useContext(ServicesContext);
  if (!context) throw new Error("useServices must be used inside <ServicesProvider>.");
  return context;
}
