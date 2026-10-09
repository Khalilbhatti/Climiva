"use client";

import type { ReactNode } from "react";
import { FinancialProvider } from "@/components/financials/FinancialProvider";
import { MaintenancePlansProvider } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { MarketingProvider } from "@/components/marketing/MarketingProvider";
import { MarketplaceProvider } from "@/components/marketplace/MarketplaceProvider";
import { OperationsProvider } from "@/components/operations/OperationsProvider";
import { ReviewsProvider } from "@/components/reviews/ReviewsProvider";
import { ServicesProvider } from "@/components/services/ServicesProvider";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { TeamProvider } from "@/components/team/TeamProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { WebsiteProvider } from "@/components/website/WebsiteProvider";
import { DirectoryProvider } from "@/components/workspace/DirectoryProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { EMPTY_MARKETING_DATA } from "@/data/marketing";
import type { CoreSnapshot } from "@/data/directory";
import type { WorkspaceSnapshot } from "@/lib/workspace-types";

/**
 * Everything the signed-in workspace needs, mounted once around it.
 *
 * `snapshot` (the person, their workspaces, the active workspace's stored settings) and `core` (its Services, team, customers
 * and operations) were read and verified on the server for this request. They are changed through server actions and re-read
 * from PostgreSQL on every load.
 *
 * Customers, Services, the team, the operations (Bookings, Jobs, the Schedule's blocks), the financials (Quotes, Invoices,
 * Payments), the Maintenance Plans and the Reviews are on the database: each business gets its own, read for the active
 * organization only. The modules that are not on the database yet (Marketing …) keep their in-memory stores. Those start from the
 * built-in sample records ONLY for the sample business; every other business starts them empty, so a customer or a Service of
 * one business can never be matched to another's sample records. The customer-facing previews sit inside the same providers so
 * they read what the workspace saved.
 *
 * Callers pass `key={snapshot.organization.id}`, so a different workspace can never inherit any state from another.
 */
export function AppProviders({ snapshot, core, children }: { snapshot: WorkspaceSnapshot; core: CoreSnapshot; children: ReactNode }) {
  const sample = snapshot.hasSampleData;
  return (
    <WorkspaceProvider snapshot={snapshot}>
      <ToastProvider>
        <SettingsProvider initial={snapshot.settings}>
          <ServicesProvider initial={core.services}>
            <TeamProvider initial={core.team}>
              <DirectoryProvider book={core.book}>
                <OperationsProvider initial={core.operations}>
                  <FinancialProvider initial={core.financials}>
                    <MaintenancePlansProvider initial={core.maintenance}>
                      <WebsiteProvider>
                        <MarketplaceProvider>
                          <ReviewsProvider initial={core.reviews}>
                            <MarketingProvider initial={sample ? undefined : EMPTY_MARKETING_DATA}>{children}</MarketingProvider>
                          </ReviewsProvider>
                        </MarketplaceProvider>
                      </WebsiteProvider>
                    </MaintenancePlansProvider>
                  </FinancialProvider>
                </OperationsProvider>
              </DirectoryProvider>
            </TeamProvider>
          </ServicesProvider>
        </SettingsProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
