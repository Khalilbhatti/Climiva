"use client";

import type { ReactNode } from "react";
import { FinancialProvider } from "@/components/financials/FinancialProvider";
import { MaintenancePlansProvider } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { MarketingProvider } from "@/components/marketing/MarketingProvider";
import { MarketplaceProvider } from "@/components/marketplace/MarketplaceProvider";
import { OperationsProvider } from "@/components/operations/OperationsProvider";
import { ReportingProvider } from "@/components/reporting/ReportingProvider";
import { ReviewsProvider } from "@/components/reviews/ReviewsProvider";
import { ServicesProvider } from "@/components/services/ServicesProvider";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { TeamProvider } from "@/components/team/TeamProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { WebsiteProvider } from "@/components/website/WebsiteProvider";
import { DirectoryProvider } from "@/components/workspace/DirectoryProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import type { CoreSnapshot } from "@/data/directory";
import type { WorkspaceSnapshot } from "@/lib/workspace-types";

/**
 * Everything the signed-in workspace needs, mounted once around it. Only `WorkspaceProviders` (src/server/workspace-providers.tsx) mounts this, and only
 * the workspace, the signed-in Draft previews and the signed-in "not found" page use that: never the root layout, a published Site or listing, or Log in.
 *
 * `snapshot` (the person, their workspaces, the active workspace's stored settings) and `core` (its Services, team, customers
 * and operations) were read and verified on the server for this request. They are changed through server actions and re-read
 * from PostgreSQL on every load.
 *
 * Customers, Services, the team, the operations (Bookings, Jobs, the Schedule's blocks), the financials (Quotes, Invoices,
 * Payments), the Maintenance Plans, the Reviews, the Marketing campaigns, the Website (the primary site's Draft and Published snapshot)
 * and the Marketplace listing are on the database: each business gets its own, read for the active organization only (as are the reporting
 * totals the sidebar and the Plans and Reviews screens show). Nothing here starts from a built-in sample. The signed-in previews of the
 * website and the listing (`app/(signed-in)/(preview)`) share the same providers so they read what the workspace saved; the PUBLISHED website and listing a visitor
 * opens (`app/(public)`) are separate routes with no providers at all, whoever is signed in.
 *
 * Callers pass `key={snapshot.organization.id}`, so a different workspace can never inherit any state from another.
 */
export function AppProviders({ snapshot, core, children }: { snapshot: WorkspaceSnapshot; core: CoreSnapshot; children: ReactNode }) {
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
                      <WebsiteProvider initial={core.website}>
                        <MarketplaceProvider initial={core.marketplace}>
                          <ReviewsProvider initial={core.reviews}>
                            <MarketingProvider initial={core.marketing}>
                              <ReportingProvider reporting={core.reporting}>{children}</ReportingProvider>
                            </MarketingProvider>
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
