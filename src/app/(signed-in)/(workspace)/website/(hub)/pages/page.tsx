import type { Metadata } from "next";
import { PagesContent } from "@/components/website/PagesContent";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Website pages" };

export default async function WebsitePagesPage() {
  await requireWorkspaceContext();
  return <PagesContent />;
}
