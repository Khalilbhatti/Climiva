import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageEditor } from "@/components/website/PageEditor";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// The route's [pageId] is the page's stable key ("home", "services", "about" ...), looked up in the ACTIVE business's own Draft.
export async function generateMetadata({ params }: PageProps<"/website/pages/[pageId]">): Promise<Metadata> {
  await requireWorkspaceContext();
  const { pageId } = await params;
  const page = (await getCoreSnapshot())?.website?.draft.pages.find((candidate) => candidate.key === pageId);
  return { title: page ? `Edit ${page.title} page` : "Page not found" };
}

export default async function WebsitePageEditorPage({ params }: PageProps<"/website/pages/[pageId]">) {
  await requireWorkspaceContext();
  const { pageId } = await params;
  const website = (await getCoreSnapshot())?.website;
  if (!website) redirect("/website");
  const page = website.draft.pages.find((candidate) => candidate.key === pageId);
  if (!page) notFound();
  return <PageEditor pageKey={page.key} />;
}
