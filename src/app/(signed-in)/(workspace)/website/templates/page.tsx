import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TemplateGallery } from "@/components/website/templates/TemplateGallery";
import { getCoreSnapshot } from "@/server/core-data";
import { getTemplateGallery } from "@/server/templates";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Website templates" };

/**
 * The Template Gallery for the ACTIVE business's website. Anyone in the business may look at the templates; only an owner or admin can use
 * one (the page says so, and the server refuses anyone else regardless). The templates are the application's own: the same for every
 * business, read without any of the business's private records.
 */
export default async function WebsiteTemplatesPage() {
  const context = await requireWorkspaceContext();
  const website = (await getCoreSnapshot())?.website;
  if (!website) redirect("/website");
  return <TemplateGallery templates={await getTemplateGallery(context)} />;
}
