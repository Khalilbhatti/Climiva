import { Suspense, type ReactNode } from "react";
import { WebsiteChrome } from "@/components/website/WebsiteChrome";
import { WebsiteOverview } from "@/components/website/WebsiteOverview";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

/**
 * The Website hub: shared header, publishing actions and tabs. The page editors sit outside it (they have their own header). A business
 * that has no website yet sees the first-time screen (create one) in place of every tab.
 */
export default async function WebsiteHubLayout({ children }: { children: ReactNode }) {
  await requireWorkspaceContext();
  const website = (await getCoreSnapshot())?.website;
  return (
    <>
      <WebsiteChrome />
      {website ? (
        children
      ) : (
        <Suspense>
          <WebsiteOverview />
        </Suspense>
      )}
    </>
  );
}
