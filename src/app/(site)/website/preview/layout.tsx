import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { PreviewShell } from "@/components/website/preview/PreviewShell";

// The customer-facing website. Lives outside the (workspace) group on purpose: no sidebar, no workspace header.
// The providers that hold the session's website and booking data are mounted at the app root, so edits made in the
// editor and bookings made here are shared with the workspace.
export const metadata: Metadata = {
  title: "Website preview",
  robots: { index: false },
};

export default function PreviewLayout({ children }: { children: ReactNode }) {
  // The shell reads ?view=live from the URL, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <PreviewShell>{children}</PreviewShell>
    </Suspense>
  );
}
