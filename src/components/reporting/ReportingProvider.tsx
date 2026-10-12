"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CoreSnapshot } from "@/data/directory";

type Reporting = CoreSnapshot["reporting"];

const ReportingContext = createContext<Reporting | null>(null);

/**
 * What the browser needs of the reporting layer for the ACTIVE workspace, as the server read it for this page load: the imported
 * adjustments to the Plans and Reviews totals (none for a business without reporting history) and the headline totals of the
 * current month that the sidebar shows. Read-only: Analytics, the Overview and these totals are computed on the server from the
 * business's own rows, so nothing here is a figure written down in the page's JavaScript.
 */
export function ReportingProvider({ reporting, children }: { reporting: Reporting; children: ReactNode }) {
  return <ReportingContext value={reporting}>{children}</ReportingContext>;
}

export function useReporting(): Reporting {
  const context = useContext(ReportingContext);
  if (!context) throw new Error("useReporting must be used inside <ReportingProvider>.");
  return context;
}
