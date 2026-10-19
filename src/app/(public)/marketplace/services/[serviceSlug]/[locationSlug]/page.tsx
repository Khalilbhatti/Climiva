import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryPage } from "@/components/marketplace/discovery/DiscoveryPage";
import { pathQuery } from "@/lib/marketplace-discovery";
import { discoveryMetadata } from "@/server/marketplace-route";

/** The providers that list one Service and work in one place. Only a combination that really has a provider is in the sitemap; any other is an empty page that search engines are told to skip. */
export async function generateMetadata({ params, searchParams }: PageProps<"/marketplace/services/[serviceSlug]/[locationSlug]">): Promise<Metadata> {
  const { serviceSlug, locationSlug } = await params;
  const query = pathQuery(await searchParams, { service: serviceSlug, location: locationSlug });
  return query ? discoveryMetadata(query, "combination") : { title: { absolute: "Page not found" }, robots: { index: false } };
}

export default async function MarketplaceCombinationPage({ params, searchParams }: PageProps<"/marketplace/services/[serviceSlug]/[locationSlug]">) {
  const { serviceSlug, locationSlug } = await params;
  const query = pathQuery(await searchParams, { service: serviceSlug, location: locationSlug });
  if (!query) notFound();
  return <DiscoveryPage query={query} mode="combination" />;
}
