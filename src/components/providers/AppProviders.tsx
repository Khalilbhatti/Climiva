"use client";

import type { ReactNode } from "react";
import { FinancialProvider } from "@/components/financials/FinancialProvider";
import { MaintenancePlansProvider } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { MarketingProvider } from "@/components/marketing/MarketingProvider";
import { MarketplaceProvider } from "@/components/marketplace/MarketplaceProvider";
import { OperationsProvider } from "@/components/operations/OperationsProvider";
import { ReviewsProvider } from "@/components/reviews/ReviewsProvider";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { TeamProvider } from "@/components/team/TeamProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { WebsiteProvider } from "@/components/website/WebsiteProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import type { WorkspaceSnapshot } from "@/lib/workspace-types";

/**
 * Everything the signed-in workspace needs, mounted once around it. `snapshot` was read and verified on the server for
 * this request (the person, their workspaces, the active workspace's stored settings); the in-memory demo stores below
 * start from their built-in sample data and still reset on reload. The customer-facing previews sit inside the same
 * providers so they read what the workspace saved.
 *
 * Callers pass `key={snapshot.organization.id}`, so a different workspace can never inherit any state from another.
 */
export function AppProviders({ snapshot, children }: { snapshot: WorkspaceSnapshot; children: ReactNode }) {
  return (
    <WorkspaceProvider snapshot={snapshot}>
      <ToastProvider>
        <SettingsProvider initial={snapshot.settings}>
          <TeamProvider>
            <OperationsProvider>
              <FinancialProvider>
                <MaintenancePlansProvider>
                  <WebsiteProvider>
                    <MarketplaceProvider>
                      <ReviewsProvider>
                        <MarketingProvider>{children}</MarketingProvider>
                      </ReviewsProvider>
                    </MarketplaceProvider>
                  </WebsiteProvider>
                </MaintenancePlansProvider>
              </FinancialProvider>
            </OperationsProvider>
          </TeamProvider>
        </SettingsProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
