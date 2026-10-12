import type { Metadata } from "next";
import { PublicSiteRoute, publicSiteMetadata } from "@/server/public-site-route";

export async function generateMetadata({ params }: PageProps<"/sites/[siteSlug]/[...slug]">): Promise<Metadata> {
  const { siteSlug, slug } = await params;
  return publicSiteMetadata(siteSlug, slug);
}

/** Any other page of a published website, or one Service's booking journey under its Booking page. */
export default async function PublicSitePage({ params }: PageProps<"/sites/[siteSlug]/[...slug]">) {
  const { siteSlug, slug } = await params;
  return <PublicSiteRoute siteSlug={siteSlug} segments={slug} />;
}
