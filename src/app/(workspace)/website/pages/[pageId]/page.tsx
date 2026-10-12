import { redirect } from "next/navigation";
import { requireWorkspaceContext } from "@/server/workspace";

/**
 * The page editor that used to live here is now the Website Builder. This address stays so a saved link or bookmark still lands on the
 * same page, in the Builder. The [pageId] is the page's stable key; whether it exists in this business's Draft is the Builder's to say.
 */
export default async function WebsitePageEditorRedirect({ params }: PageProps<"/website/pages/[pageId]">) {
  await requireWorkspaceContext();
  const { pageId } = await params;
  redirect(`/website/builder?page=${encodeURIComponent(pageId)}`);
}
