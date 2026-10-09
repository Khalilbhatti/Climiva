"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useServices } from "@/components/services/ServicesProvider";
import { initialWebsiteState, type PageContent, type PageId, type ServiceDisplay, type WebsiteState } from "@/data/website";
import * as state from "@/lib/website-state";

type WebsiteContextValue = {
  /** The working site: the baseline plus any demo edits made in this session. */
  site: WebsiteState;
  savePage: (page: PageId, content: PageContent, services?: ServiceDisplay) => void;
  publish: () => void;
  unpublish: () => void;
  connectCustomDomain: (host: string) => void;
  makeCustomPrimary: () => void;
  makeClimviaPrimary: () => void;
  removeCustomDomain: () => void;
};

const WebsiteContext = createContext<WebsiteContextValue | null>(null);

/**
 * The demo copy of the website for the whole app. Mounted at the app root (not inside the workspace layout)
 * because the customer-facing preview lives outside the workspace shell yet must show the edits made inside it.
 * It lives only in memory; a reload restores the baseline, and nothing is sent anywhere.
 */
export function WebsiteProvider({ children }: { children: ReactNode }) {
  // Starts from the business's Services as they were when the page loaded; the site's own content is held here.
  const { services } = useServices();
  const [site, setSite] = useState<WebsiteState>(() => initialWebsiteState(services));
  const latest = useRef(site);

  const commit = useCallback((next: WebsiteState) => {
    latest.current = next;
    setSite(next);
  }, []);

  const value = useMemo<WebsiteContextValue>(
    () => ({
      site,
      savePage: (page, content, services) => commit(state.savePage(latest.current, page, content, services)),
      publish: () => commit(state.publish(latest.current)),
      unpublish: () => commit(state.unpublish(latest.current)),
      connectCustomDomain: (host) => commit(state.connectCustomDomain(latest.current, host)),
      makeCustomPrimary: () => commit(state.makeCustomPrimary(latest.current)),
      makeClimviaPrimary: () => commit(state.makeClimviaPrimary(latest.current)),
      removeCustomDomain: () => commit(state.removeCustomDomain(latest.current)),
    }),
    [site, commit],
  );

  return <WebsiteContext value={value}>{children}</WebsiteContext>;
}

export function useWebsite(): WebsiteContextValue {
  const context = useContext(WebsiteContext);
  if (!context) throw new Error("useWebsite must be used inside <WebsiteProvider>.");
  return context;
}
