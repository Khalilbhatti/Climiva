import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryPage } from "@/components/marketplace/discovery/DiscoveryPage";
import { pathQuery } from "@/lib/marketplace-discovery";
import { discoveryMetadata } from "@/server/marketplace-route";

/** The providers that list one Service (its address is the Service's own). A Service nobody lists is an empty page that search engines are told to skip. */
export async function generateMetadata({ params, searchParams }: PageProps<"/marketplace/services/[serviceSlug]">): Promise<Metadata> {
  const query = pathQuery(await searchParams, { service: (await params).serviceSlug });
  return query ? discoveryMetadata(query, "service") : { title: { absolute: "Page not found" }, robots: { index: false } };
}

export default async function MarketplaceServicePage({ params, searchParams }: PageProps<"/marketplace/services/[serviceSlug]">) {
  const query = pathQuery(await searchParams, { service: (await params).serviceSlug });
  if (!query) notFound();
  return <DiscoveryPage query={query} mode="service" />;
}
