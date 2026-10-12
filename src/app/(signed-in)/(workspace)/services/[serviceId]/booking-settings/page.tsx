import { BookingSettingsTab } from "@/components/services/ServiceTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function ServiceBookingSettingsPage() {
  await requireWorkspaceContext();
  return <BookingSettingsTab />;
}
