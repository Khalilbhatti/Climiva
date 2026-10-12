"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useHoursRows, useBusiness } from "@/components/settings/SettingsProvider";
import { useServices } from "@/components/services/ServicesProvider";
import { getPrimaryDomain, orderedPages, platformHost, type PageModel, type ServiceDisplay, type VersionModel, type WebsiteState } from "@/data/website";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import {
  connectDomainAction,
  createWebsiteAction,
  publishWebsiteAction,
  removeDomainAction,
  savePageAction,
  setPrimaryAddressAction,
  unpublishWebsiteAction,
} from "@/server/actions/website";
import type { SiteView } from "./site-view";

type Done = Promise<ActionResult<{ website: WebsiteState | null; versionNumber?: number }>>;

/** What a page save sends: each section's visibility and text, and (the Services page) which Services the site shows. */
export type PageSave = {
  sections: Record<string, { visible: boolean; props: Record<string, string> }>;
  serviceDisplay?: ServiceDisplay;
};

type WebsiteContextValue = {
  /** The business's primary website as stored (its Draft and Published snapshot), or null before one has been created. */
  website: WebsiteState | null;
  createWebsite: () => Done;
  savePage: (pageKey: string, save: PageSave) => Done;
  publish: () => Done;
  unpublish: () => Done;
  connectDomain: (domain: string) => Done;
  setPrimaryAddress: (primary: "climvia" | "custom") => Done;
  removeDomain: () => Done;
};

const WebsiteContext = createContext<WebsiteContextValue | null>(null);

/**
 * The business's primary website for the whole workspace. `initial` is what the server read from PostgreSQL for this page load, for the
 * ACTIVE organization only. Every change goes to the server, which authorizes it (owner or admin), validates it, stores it in one
 * transaction and answers with the website as stored; only then does the working copy change, so the screen is never ahead of the
 * database. Saving edits the Draft; only Publish changes what visitors see. The customer-facing PREVIEW sits outside the workspace shell
 * but inside this provider, so it shows the saved Draft.
 */
export function WebsiteProvider({ initial, children }: { initial: WebsiteState | null; children: ReactNode }) {
  const [website, setWebsite] = useState<WebsiteState | null>(initial);

  const adopt = useCallback((result: ActionResult<{ website: WebsiteState | null; versionNumber?: number }>) => {
    if (result.ok) setWebsite(result.data.website);
    return result;
  }, []);

  const value = useMemo<WebsiteContextValue>(
    () => ({
      website,
      createWebsite: async () => adopt(await send(() => createWebsiteAction())),
      savePage: async (pageKey, save) => adopt(await send(() => savePageAction({ page: pageKey, ...save }))),
      publish: async () => adopt(await send(() => publishWebsiteAction())),
      unpublish: async () => adopt(await send(() => unpublishWebsiteAction())),
      connectDomain: async (domain) => adopt(await send(() => connectDomainAction({ domain }))),
      setPrimaryAddress: async (primary) => adopt(await send(() => setPrimaryAddressAction({ primary }))),
      removeDomain: async () => adopt(await send(() => removeDomainAction())),
    }),
    [website, adopt],
  );

  return <WebsiteContext value={value}>{children}</WebsiteContext>;
}

export function useWebsite(): WebsiteContextValue {
  const context = useContext(WebsiteContext);
  if (!context) throw new Error("useWebsite must be used inside <WebsiteProvider>.");
  return context;
}

/**
 * The website that must exist: for the screens that only make sense once the business has one (they show the "no website yet" state
 * before). Throws if it does not, which the screens prevent by checking `website` first.
 */
export function useWebsiteState(): WebsiteState {
  const { website } = useWebsite();
  if (!website) throw new Error("This screen needs the website to exist.");
  return website;
}

/** The address visitors use: the main one (a recorded custom domain made main, otherwise the platform address). Null with no website. */
export function useSiteAddress(): string | null {
  const { website } = useWebsite();
  return website ? getPrimaryDomain(website.site, website.domain) : null;
}

/** The platform address (`<slug>.climvia.com`) of the business's primary site, or null with no website. */
export function usePlatformAddress(): string | null {
  const { website } = useWebsite();
  return website ? platformHost(website.site.platformSlug) : null;
}

/**
 * A version of the website as the renderer draws it inside the workspace: the business and its hours from Settings, its Services from the
 * catalog (the version only chooses which are shown), and the version's own pages and theme. `base` is where its pages' links lead.
 */
export function useSiteView(version: VersionModel, base: string): SiteView {
  const business = useBusiness();
  const hours = useHoursRows();
  const { services } = useServices();
  return useMemo(
    () => ({
      business,
      hours,
      services,
      display: version.settings.serviceDisplay,
      theme: version.theme,
      base,
      pages: orderedPages(version)
        .filter((page) => page.visible)
        .map((page) => ({ key: page.key, title: page.title, slug: page.slug, type: page.type })),
      visitor: false,
    }),
    [business, hours, services, version, base],
  );
}

export type { PageModel };
