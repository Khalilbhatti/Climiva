import { BookingJourney } from "@/components/website/preview/BookingJourney";
import { publicGate } from "@/server/fixture-gate";

export default async function PreviewBookingJourneyPage({ params }: PageProps<"/website/preview/booking/[serviceId]">) {
  const gate = await publicGate();
  if (gate) return gate;
  const { serviceId } = await params;
  return <BookingJourney serviceId={serviceId} />;
}
