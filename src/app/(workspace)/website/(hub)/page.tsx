import type { Metadata } from "next";
import { Suspense } from "react";
import { WebsiteOverview } from "@/components/website/WebsiteOverview";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Website" };

export default async function WebsitePage() {
  await requireWorkspaceContext();
  // ?state=empty previews the "no website yet" state, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <WebsiteOverview />
    </Suspense>
  );
}
