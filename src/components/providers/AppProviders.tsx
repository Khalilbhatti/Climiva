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

/**
 * Every in-memory demo store, mounted once at the app root. They used to sit in the workspace layout; the
 * Website and Marketplace previews (customer-facing pages outside the workspace shell) need the same session data,
 * and React keeps provider state only across routes that share the provider's ancestors. Nothing here persists:
 * a reload restores the canonical fixtures.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SettingsProvider>
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
  );
}
