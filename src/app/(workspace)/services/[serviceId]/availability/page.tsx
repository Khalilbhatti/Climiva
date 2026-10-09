import { AvailabilityTab } from "@/components/services/ServiceTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function ServiceAvailabilityPage() {
  await requireWorkspaceContext();
  return <AvailabilityTab />;
}
