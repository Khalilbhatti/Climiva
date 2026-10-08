import type { Metadata } from "next";
import { PagesContent } from "@/components/website/PagesContent";

export const metadata: Metadata = { title: "Website pages" };

export default function WebsitePagesPage() {
  return <PagesContent />;
}
