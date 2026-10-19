import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DiscoveryPage } from "@/components/marketplace/discovery/DiscoveryPage";
import { readDiscoveryQuery, tidyAddress } from "@/lib/marketplace-discovery";
import { discoveryMetadata } from "@/server/marketplace-route";

/**
 * The public Marketplace: a visitor says what they need and where, and sees the providers that really offer it there. No session, no workspace
 * and no sign-in; the page is drawn from the public discovery projection only (a published, not suspended listing, its selected Services and
 * the places it listed). What is in the address is the search: `?q=ac+repair&location=78704&page=2`. Anything in it that does not fit is
 * ignored rather than refused, and a search that only names a Service or a place goes to that Service's or place's clean page.
 */
export async function generateMetadata({ searchParams }: PageProps<"/marketplace">): Promise<Metadata> {
  return discoveryMetadata(readDiscoveryQuery(await searchParams), "index");
}

export default async function MarketplacePage({ searchParams }: PageProps<"/marketplace">) {
  const params = await searchParams;
  const query = readDiscoveryQuery(params);
  const tidy = tidyAddress(params, query);
  if (tidy) redirect(tidy);
  return <DiscoveryPage query={query} mode="index" />;
}
