import "server-only";
import { notFound, redirect } from "next/navigation";
import { PreviewPage } from "@/components/website/preview/PreviewPage";
import { orderedPages } from "@/data/website";
import { publicSiteHref } from "@/lib/site-domain";
import { getCoreSnapshot } from "./core-data";
import { requireWorkspaceContext } from "./workspace";

/**
 * A page of the saved Draft (or one Service's booking journey under the Booking page), for someone signed in to the business. Every
 * address is checked against the Draft's own visible pages, so an address that names nothing is "not found". The route files under
 * src/app/(site)/website/preview call this for the home page and for every other page.
 */
export async function PreviewRoute({ segments, view }: { segments: string[]; view: string | undefined }) {
  await requireWorkspaceContext();
  const website = (await getCoreSnapshot())?.website;
  if (!website) redirect("/website");

  // Older links asked for the live view of a page here. The published site is its own route now.
  if (view === "live") redirect(publicSiteHref(website.site.platformSlug, segments.length > 0 ? `/${segments.join("/")}` : ""));

  const page = orderedPages(website.draft).find((candidate) => candidate.visible && candidate.slug === (segments[0] ?? ""));
  if (!page || segments.length > 2 || (segments.length === 2 && page.type !== "booking")) notFound();
  return <PreviewPage segments={segments} />;
}
