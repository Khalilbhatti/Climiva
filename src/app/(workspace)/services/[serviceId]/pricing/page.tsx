import { PricingTab } from "@/components/services/ServiceTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function ServicePricingPage() {
  await requireWorkspaceContext();
  return <PricingTab />;
}
