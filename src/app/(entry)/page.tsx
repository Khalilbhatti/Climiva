import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/Landing";
import { platformOrigin } from "@/lib/domain-config";
import { jsonLd, landingStructuredData } from "@/lib/structured-data";
import { entryDestination } from "@/server/entry";

/**
 * The public landing: what Climvia is, a way to find HVAC service and a way to list a business. Indexable, with its canonical address built from the
 * platform's own configured address (never from the request). Everyone who is not a business member sees this page, and it is the same page for all of
 * them; a business member is sent to their dashboard, and a platform administrator with no business of their own is not made to create one.
 */
export function generateMetadata(): Metadata {
  const origin = platformOrigin();
  return {
    title: { absolute: "Climvia · Find HVAC service. Run the business behind it." },
    description:
      "Climvia is where homeowners find HVAC businesses, and where those businesses take bookings, schedule jobs, send quotes and invoices, collect reviews and run a website and Marketplace listing.",
    ...(origin ? { alternates: { canonical: `${origin}/` } } : {}),
    robots: { index: true, follow: true },
  };
}

export default async function EntryPage() {
  const destination = await entryDestination();
  if (destination.kind === "redirect") redirect(destination.to);
  const data = landingStructuredData(platformOrigin());
  return (
    <>
      {data && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />}
      <Landing />
    </>
  );
}
