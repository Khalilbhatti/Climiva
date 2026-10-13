import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TemplatePreview } from "@/components/website/templates/TemplatePreview";
import { getCoreSnapshot } from "@/server/core-data";
import { getTemplateGallery } from "@/server/templates";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Template preview" };

/**
 * One Template in full, for the ACTIVE business: every page of it at Desktop, Tablet and Mobile width, with a demonstration business.
 * `?page=<key>` opens one of the Template's own pages. A key that is not an active Template is "not found". Nothing is written.
 */
export default async function WebsiteTemplatePreviewPage({ params, searchParams }: PageProps<"/website/templates/[templateKey]">) {
  const context = await requireWorkspaceContext();
  const website = (await getCoreSnapshot())?.website;
  if (!website) redirect("/website");
  const { templateKey } = await params;
  const { page } = await searchParams;
  const template = (await getTemplateGallery(context)).find((candidate) => candidate.key === templateKey);
  if (!template) notFound();
  return <TemplatePreview template={template} initialPage={typeof page === "string" ? page : undefined} />;
}
