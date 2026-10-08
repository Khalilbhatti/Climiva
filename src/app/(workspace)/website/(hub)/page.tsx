import type { Metadata } from "next";
import { Suspense } from "react";
import { WebsiteOverview } from "@/components/website/WebsiteOverview";

export const metadata: Metadata = { title: "Website" };

export default function WebsitePage() {
  // ?state=empty previews the "no website yet" state, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <WebsiteOverview />
    </Suspense>
  );
}
