import type { Metadata } from "next";
import { HelpAreas } from "@/components/help/HelpAreas";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Help" description="Find the workspace area you need help with." />
      <HelpAreas />
    </>
  );
}
