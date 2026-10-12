import type { Metadata } from "next";
import { PublicSiteRoute, publicSiteMetadata } from "@/server/public-site-route";

export async function generateMetadata({ params }: PageProps<"/sites/[siteSlug]">): Promise<Metadata> {
  const { siteSlug } = await params;
  return publicSiteMetadata(siteSlug, []);
}

/** The home page of a published website. */
export default async function PublicSiteHome({ params }: PageProps<"/sites/[siteSlug]">) {
  const { siteSlug } = await params;
  return <PublicSiteRoute siteSlug={siteSlug} segments={[]} />;
}
