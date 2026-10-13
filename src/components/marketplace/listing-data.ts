"use client";

import { orderedPages, platformHost } from "@/data/website";
import { getListingServices, type ListingConfig } from "@/data/marketplace";
import { useServices } from "@/components/services/ServicesProvider";
import { useBusiness, useHoursRows, useSettings } from "@/components/settings/SettingsProvider";
import { PREVIEW_BASE } from "@/components/website/site-links";
import { useWebsite } from "@/components/website/WebsiteProvider";
import type { ListingViewData } from "./ListingView";

/**
 * A listing configuration as the workspace draws it: the business from Settings, its hours, the Services the listing selects (in its order,
 * read from the catalog), and the website's address. The actions lead to the saved Draft's pages (the signed-in preview), or nowhere when
 * the business has no website.
 */
export function useListingData(config: ListingConfig): ListingViewData {
  const business = useBusiness();
  const logo = useSettings().settings.branding.logo;
  const hours = useHoursRows();
  const { services: catalog } = useServices();
  const { website } = useWebsite();
  return {
    description: config.description,
    cover: config.cover,
    contact: config.contact,
    actions: config.actions,
    business,
    logo: logo ? { src: logo.src } : null,
    hours,
    services: getListingServices(config, catalog),
    website: website ? platformHost(website.site.platformSlug) : null,
    site: website
      ? { base: PREVIEW_BASE, pages: orderedPages(website.draft).filter((page) => page.visible).map((page) => ({ key: page.key, title: page.title, slug: page.slug, type: page.type })) }
      : null,
  };
}
