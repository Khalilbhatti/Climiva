import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WebsiteBuilder } from "@/components/website/builder/WebsiteBuilder";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Website Builder" };

/**
 * The visual Website Builder for the ACTIVE business's primary website. `?page=<key>` opens a page of its own Draft (the home page when
 * absent); a key that is not one of this Draft's pages is "not found", never another business's page and never a fallback to sample content.
 * Anyone in the business may open it; only an owner or admin can change anything (the Builder shows a read-only view to the rest, and the
 * server refuses their edits regardless).
 */
export default async function WebsiteBuilderPage({ searchParams }: PageProps<"/website/builder">) {
  await requireWorkspaceContext();
  const website = (await getCoreSnapshot())?.website;
  if (!website) redirect("/website");
  const { page } = await searchParams;
  const requested = typeof page === "string" && page !== "" ? page : undefined;
  if (requested && !website.draft.pages.some((candidate) => candidate.key === requested)) notFound();
  return <WebsiteBuilder initialPage={requested} />;
}
