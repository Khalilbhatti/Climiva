/**
 * Pure state transitions for the Website demo. Nothing is deployed, resolved or verified anywhere: publishing
 * copies the saved draft to the "live" snapshot in memory, and a domain is a name held in state.
 *
 * Publishing and domains are independent: connecting or removing a custom domain never changes the content or
 * the published flag, and publishing never needs a custom domain.
 */
import {
  CLIMVIA_DOMAIN,
  type PageContent,
  type PageId,
  type ServiceDisplay,
  type WebsiteState,
} from "@/data/website";

/** Saves one page's edits to the draft. The Services page also saves which services are shown, and in what order. */
export function savePage(state: WebsiteState, page: PageId, content: PageContent, services?: ServiceDisplay): WebsiteState {
  return {
    ...state,
    draft: {
      pages: { ...state.draft.pages, [page]: content },
      services: services ?? state.draft.services,
    },
  };
}

/** Makes the saved draft the live site. */
export function publish(state: WebsiteState): WebsiteState {
  return { ...state, published: true, live: state.draft };
}

/** Makes the site private. Pages and content are kept. */
export function unpublish(state: WebsiteState): WebsiteState {
  return { ...state, published: false };
}

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** A hostname that looks like a domain name; nothing is looked up. */
export function normalizeDomain(input: string): string | undefined {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return HOST.test(host) && host !== CLIMVIA_DOMAIN ? host : undefined;
}

export function connectCustomDomain(state: WebsiteState, host: string): WebsiteState {
  return { ...state, domain: { custom: host, primary: "climvia" } };
}

export function makeCustomPrimary(state: WebsiteState): WebsiteState {
  return state.domain.custom ? { ...state, domain: { ...state.domain, primary: "custom" } } : state;
}

/** Either address can be the main one; the Climvia address can never be removed, so this always applies. */
export function makeClimviaPrimary(state: WebsiteState): WebsiteState {
  return { ...state, domain: { ...state.domain, primary: "climvia" } };
}

/** Removing the custom domain returns the Climvia address as the primary one. Content and publishing are untouched. */
export function removeCustomDomain(state: WebsiteState): WebsiteState {
  return { ...state, domain: { custom: undefined, primary: "climvia" } };
}
