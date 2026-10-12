import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PreviewShell } from "@/components/website/preview/PreviewShell";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// The signed-in preview of the saved Draft. Lives in the (preview) group on purpose: the workspace's providers (from the (signed-in) layout) but no
// sidebar and no workspace header. It is not the published site: that is /sites/<address> in (public), open to visitors and mounting nothing.
export const metadata: Metadata = {
  title: "Website preview",
  robots: { index: false },
};

export default async function PreviewLayout({ children }: { children: ReactNode }) {
  await requireWorkspaceContext();
  const core = await getCoreSnapshot();
  // A business with no website yet has nothing to preview: the Website module offers to create one.
  if (!core?.website) redirect("/website");
  return <PreviewShell>{children}</PreviewShell>;
}
