import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageEditor } from "@/components/website/PageEditor";
import { WEBSITE_PAGES, getWebsitePage } from "@/data/website";

export function generateStaticParams() {
  return WEBSITE_PAGES.map((page) => ({ pageId: page.id }));
}

export async function generateMetadata({ params }: PageProps<"/website/pages/[pageId]">): Promise<Metadata> {
  const { pageId } = await params;
  const page = getWebsitePage(pageId);
  return { title: page ? `Edit ${page.title} page` : "Page not found" };
}

export default async function WebsitePageEditorPage({ params }: PageProps<"/website/pages/[pageId]">) {
  const { pageId } = await params;
  const page = getWebsitePage(pageId);
  if (!page) notFound();
  return <PageEditor pageId={page.id} />;
}
