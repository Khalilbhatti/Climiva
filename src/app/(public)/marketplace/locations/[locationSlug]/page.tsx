import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryPage } from "@/components/marketplace/discovery/DiscoveryPage";
import { pathQuery } from "@/lib/marketplace-discovery";
import { discoveryMetadata } from "@/server/marketplace-route";

/** The providers that listed one place ("austin-tx", or a ZIP) as somewhere they work. A place nobody listed is an empty page that search engines are told to skip. */
export async function generateMetadata({ params, searchParams }: PageProps<"/marketplace/locations/[locationSlug]">): Promise<Metadata> {
  const query = pathQuery(await searchParams, { location: (await params).locationSlug });
  return query ? discoveryMetadata(query, "location") : { title: { absolute: "Page not found" }, robots: { index: false } };
}

export default async function MarketplaceLocationPage({ params, searchParams }: PageProps<"/marketplace/locations/[locationSlug]">) {
  const query = pathQuery(await searchParams, { location: (await params).locationSlug });
  if (!query) notFound();
  return <DiscoveryPage query={query} mode="location" />;
}
