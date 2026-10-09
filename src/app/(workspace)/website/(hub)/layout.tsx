import type { ReactNode } from "react";
import { WebsiteChrome } from "@/components/website/WebsiteChrome";
import { fixtureGate } from "@/server/fixture-gate";

/** The Website hub: shared header, publishing actions and tabs. The page editors sit outside it (they have their own header). */
export default async function WebsiteHubLayout({ children }: { children: ReactNode }) {
  const gate = await fixtureGate("Website");
  if (gate) return gate;
  return (
    <>
      <WebsiteChrome />
      {children}
    </>
  );
}
