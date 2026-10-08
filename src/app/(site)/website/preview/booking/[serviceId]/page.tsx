import { BookingJourney } from "@/components/website/preview/BookingJourney";
import { SERVICES } from "@/data/services";

export function generateStaticParams() {
  return SERVICES.map((service) => ({ serviceId: service.id }));
}

export default async function PreviewBookingJourneyPage({ params }: PageProps<"/website/preview/booking/[serviceId]">) {
  const { serviceId } = await params;
  return <BookingJourney serviceId={serviceId} />;
}
