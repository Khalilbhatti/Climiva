import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageEditor } from "@/components/website/PageEditor";
import { getWebsitePage } from "@/data/website";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

export async function generateMetadata({ params }: PageProps<"/website/pages/[pageId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { pageId } = await params;
  const page = getWebsitePage(pageId);
  return { title: page ? `Edit ${page.title} page` : "Page not found" };
}

export default async function WebsitePageEditorPage({ params }: PageProps<"/website/pages/[pageId]">) {
  const gate = await fixtureGate("Website");
  if (gate) return gate;
  const { pageId } = await params;
  const page = getWebsitePage(pageId);
  if (!page) notFound();
  return <PageEditor pageId={page.id} />;
}
