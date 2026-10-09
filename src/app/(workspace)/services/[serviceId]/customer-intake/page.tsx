import { CustomerIntakeTab } from "@/components/services/ServiceTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function ServiceCustomerIntakePage() {
  await requireWorkspaceContext();
  return <CustomerIntakeTab />;
}
