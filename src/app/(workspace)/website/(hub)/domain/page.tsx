import type { Metadata } from "next";
import { DomainManager } from "@/components/website/DomainManager";

export const metadata: Metadata = { title: "Website domain" };

export default function WebsiteDomainPage() {
  return <DomainManager />;
}
