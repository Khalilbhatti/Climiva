import type { ReactNode } from "react";
import { ServicesProvider } from "@/components/services/ServicesProvider";

/** One in-memory catalog shared by the list, the detail pages and the Add Service wizard. */
export default function ServicesLayout({ children }: { children: ReactNode }) {
  return <ServicesProvider>{children}</ServicesProvider>;
}
