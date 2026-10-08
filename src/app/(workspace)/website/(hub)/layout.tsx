import type { ReactNode } from "react";
import { WebsiteChrome } from "@/components/website/WebsiteChrome";

/** The Website hub: shared header, publishing actions and tabs. The page editors sit outside it (they have their own header). */
export default function WebsiteHubLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WebsiteChrome />
      {children}
    </>
  );
}
