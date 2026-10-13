import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRequestSite } from "@/server/request-host";
import { PublicSiteRoute, publicSiteMetadata } from "@/server/public-site-route";

/**
 * A customer's own domain. The proxy rewrites every request whose Host is not one of the platform's names to this route (the address in the
 * browser does not change), and this page finds out which published Site the Host belongs to. It is the same renderer as `/sites/<address>`:
 * only the links (at the root of the host) and the canonical address differ.
 *
 * Reached on a platform name, or on a name nobody has activated, it is "not found": the platform's names never resolve to a customer's site
 * through here, and an unknown name never falls back to any business. Nothing else is served on a customer's domain: a path that is not a
 * page of the site (`/login`, `/settings`, `/website/builder`, `/api/...`) is just a page that does not exist.
 */

const NO_PAGE: Metadata = { title: { absolute: "Page not found" }, robots: { index: false } };

export async function generateMetadata({ params }: PageProps<"/custom-site/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const origin = await getRequestSite();
  if (origin.kind !== "custom") return NO_PAGE;
  return publicSiteMetadata(origin.host.platformSlug, slug ?? [], origin.host);
}

export default async function CustomDomainPage({ params }: PageProps<"/custom-site/[[...slug]]">) {
  const { slug } = await params;
  const origin = await getRequestSite();
  if (origin.kind !== "custom") notFound();
  return <PublicSiteRoute siteSlug={origin.host.platformSlug} segments={slug ?? []} base="" />;
}
