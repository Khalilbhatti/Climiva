import { BookingSettingsTab } from "@/components/services/ServiceTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function ServiceBookingSettingsPage() {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  return <BookingSettingsTab />;
}
