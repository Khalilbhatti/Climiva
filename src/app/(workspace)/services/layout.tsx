import type { ReactNode } from "react";
import { ServicesProvider } from "@/components/services/ServicesProvider";
import { fixtureGate } from "@/server/fixture-gate";

/** One in-memory catalog shared by the list, the detail pages and the Add Service wizard. */
export default async function ServicesLayout({ children }: { children: ReactNode }) {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  return <ServicesProvider>{children}</ServicesProvider>;
}
