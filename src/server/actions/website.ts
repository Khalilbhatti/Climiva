"use server";

import type { WebsiteState } from "@/data/website";
import { DEFAULT_TEMPLATE_KEY } from "@/db/default-template";
import { activateDomain, claimDomain, disableDomain, removeDomain, setMainDomain } from "@/db/domain-queries";
import { verifyDomainOwnership } from "@/db/domain-verification";
import type { Tx } from "@/db/index";
import {
  createDraftFromTemplate,
  findPrimarySite,
  loadWebsiteState,
  publishSite,
  replaceDraftWithTemplate,
  saveSiteDraft,
  unpublishSite,
} from "@/db/site-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_WEBSITE, failure, ok, type ActionResult } from "@/lib/action-result";
import { resolverFromEnv } from "@/lib/dns-resolver";
import { hostConfig, siteAddressing } from "@/lib/domain-config";
import { DOMAIN_IN_USE, DOMAIN_STALE, type OwnershipOutcome } from "@/lib/domain-rules";
import { Refusal, refuse } from "@/lib/refusal";
import { isRecord } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation } from "../db-errors";

/**
 * Website writes: create the website, save the Draft the Builder edited, replace it with a Template, publish, unpublish, and the custom
 * domains (claim, verify, activate, disable, remove, choose the main one). Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "website:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement: every section's text is checked against its registered type, plain text only),
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, finds the business's PRIMARY site itself,
 *      locks it, and changes the Draft (or publishes it into a new immutable snapshot) in that one transaction,
 *   5. answers with the website as stored, so the screen shows exactly what is stored.
 * No argument names an organization or a site: the site is the verified organization's primary one. A Published version is never edited
 * here; the way to change what visitors see is to edit the Draft and publish it.
 */

type Answer = { website: WebsiteState | null; versionNumber?: number; domainCheck?: OwnershipOutcome };

/** The browser gets a domain's verification record only because the caller just passed the website:manage check. */
const domains = () => ({ reveal: true, routingTarget: hostConfig().customDomainTarget, addressing: siteAddressing() });

type Work = { tx: Tx; organizationId: string; siteId: string; userId: string };

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  // A name that is already claimed (by anyone) is said in one sentence that reveals nothing about who holds it.
  if (constraint === "site_domains_hostname_unique") return failure(DOMAIN_IN_USE, { domain: DOMAIN_IN_USE });
  if (constraint === "site_domains_primary_unique" || constraint === "site_domains_transition" || constraint === "site_domains_removed_final" || constraint === "site_domains_verified_final") {
    return failure(DOMAIN_STALE);
  }
  if (constraint === "site_published_final") return failure("A published version can't be changed. Edit the draft and publish it again.");
  if (constraint === "site_versions_one_draft") return failure("This website already has a draft. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("This change can't be saved as entered, and nothing was changed. Reload the page, check what you entered and try again.");
  console.error("[website] could not save:", error instanceof Error ? error.message : error);
  return failure("We couldn't save your website. Your changes weren't saved. Try again.");
}

/** Authorize, open the tenant transaction on the primary site, run the change, and answer with the website as stored. */
async function mutate(change: (work: Work) => Promise<Partial<Answer> | void>): Promise<ActionResult<Answer>> {
  const auth = await authorize("website:manage", NOT_ALLOWED_WEBSITE);
  if (!auth.ok) return auth.result;
  const { userId, organizationId } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const site = await findPrimarySite(tx, organizationId);
      if (!site) return refuse("This workspace has no website yet.");
      const extra = (await change({ tx, organizationId, siteId: site.id, userId })) ?? {};
      const fresh = await findPrimarySite(tx, organizationId);
      return ok({ website: fresh ? await loadWebsiteState(tx, organizationId, fresh, domains()) : null, ...extra });
    });
  } catch (error) {
    return translate(error);
  }
}

/* ───────────────────────── creating ───────────────────────── */

/** Create the website's Draft from the default template. A website that already has a Draft is left alone. */
export async function createWebsiteAction(): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    await createDraftFromTemplate({ tx, organizationId }, siteId, DEFAULT_TEMPLATE_KEY);
  });
}

/* ───────────────────────── editing the Draft ───────────────────────── */

/**
 * Save the whole Draft the Website Builder edited: its theme, settings, and every page with its sections, in order, together with the
 * revision of the Draft the Builder opened. The server validates all of it again (every section against its registered type and variant,
 * plain text only), refuses it whole if the stored Draft has moved on since that revision, and otherwise stores it in one transaction.
 * Nothing in the request names an organization, a site or a database id: pages and sections are matched by their keys inside the verified
 * business's own primary Site.
 */
export async function saveDraftAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    if (!isRecord(input)) return refuse("The website was not understood.");
    await saveSiteDraft({ tx, organizationId }, siteId, { expectedRevision: input.expectedRevision, content: input.content });
  });
}

/**
 * Replace the Draft with one of the application's Templates: its pages, sections and theme. This discards the Draft's own pages and
 * sections, so the request must say it is confirmed, and it must carry the revision of the Draft the person was looking at: a Draft that
 * has moved on since (another tab saved) is refused whole, so a replacement never destroys work the person has not seen.
 *
 * The Published version is never touched: visitors keep seeing what was published until the Draft is published. The Template is named by
 * its key and must be an active application Template; nothing in the request names an organization, a site or a database id, and a
 * business cannot create or change a Template. The business's choice of which Services show (and in what order) is kept.
 */
export async function applyTemplateAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    if (!isRecord(input)) return refuse("The template was not understood.");
    const { templateKey, expectedRevision, confirmReplace } = input;
    if (typeof templateKey !== "string" || templateKey.length < 1 || templateKey.length > 60) return refuse("That website template is not available.");
    if (confirmReplace !== true) return refuse("Replacing the draft with a template discards its pages. Confirm to continue.");
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) return refuse("The website was not understood.");
    await replaceDraftWithTemplate({ tx, organizationId }, siteId, templateKey, { confirmReplace: true, expectedRevision });
  });
}

/* ───────────────────────── publishing ───────────────────────── */

/**
 * Publish the Draft: a new immutable Published version, and the site points at it. Nothing to publish is not an error. The Builder sends the
 * revision of the Draft it is showing, and a Draft that has moved on is refused, so it never publishes a state the person did not look at.
 */
export async function publishWebsiteAction(input?: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId, userId }) => {
    if (input !== undefined && (!isRecord(input) || typeof input.expectedRevision !== "number")) return refuse("The website was not understood.");
    const expectedRevision = isRecord(input) ? (input.expectedRevision as number) : undefined;
    const published = await publishSite({ tx, organizationId }, siteId, userId, { expectedRevision });
    return { versionNumber: published.number };
  });
}

/** Make the website private. Its pages, content and versions are kept. */
export async function unpublishWebsiteAction(): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    await unpublishSite({ tx, organizationId }, siteId);
  });
}

/* ───────────────────────── custom domains ───────────────────────── */

/**
 * Custom domains belong to a SITE; today the screen manages the business's primary site's, and nothing here names a site or an
 * organization. Each action needs `website:manage`, takes the claim's id and the revision the screen showed (a screen that is behind is
 * refused), and answers with the website as stored.
 */
const claimOf = (input: unknown) => (isRecord(input) ? { id: input.id, expectedRevision: input.expectedRevision } : { id: undefined, expectedRevision: undefined });

/** Claim a domain: normalized, checked against the reserved and already-claimed names, stored as pending with a new token. Nothing is verified. */
export async function addDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId, userId }) => {
    if (!isRecord(input)) return refuse("The domain was not understood.");
    await claimDomain({ tx, organizationId }, siteId, input.domain, userId, hostConfig());
  });
}

/**
 * Look for the claim's TXT record. DNS is asked between two short transactions (never inside one), a failure to reach DNS changes
 * nothing, and the answer says what was found so the screen can say what to do. Checks are rate limited by the claim's own `last_checked_at`.
 */
export async function verifyDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  const auth = await authorize("website:manage", NOT_ALLOWED_WEBSITE);
  if (!auth.ok) return auth.result;
  const { userId, organizationId } = auth.context;
  const { id, expectedRevision } = claimOf(input);
  try {
    const identity = { userId, organizationId };
    const site = await withTenant(identity, (tx) => findPrimarySite(tx, organizationId));
    if (!site) return failure("This workspace has no website yet.");
    const domainCheck = await verifyDomainOwnership(identity, site.id, id, expectedRevision, resolverFromEnv());
    const website = await withTenant(identity, async (tx) => {
      const fresh = await findPrimarySite(tx, organizationId);
      return fresh ? loadWebsiteState(tx, organizationId, fresh, domains()) : null;
    });
    return ok({ website, domainCheck });
  } catch (error) {
    return translate(error);
  }
}

/** Let the application serve the site for this verified domain. Active in Climvia is not "live": DNS and a certificate are separate. */
export async function activateDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  const { id, expectedRevision } = claimOf(input);
  return mutate(async ({ tx, organizationId, siteId }) => {
    await activateDomain({ tx, organizationId }, siteId, id, expectedRevision);
  });
}

/** Stop serving the site through this domain. The claim is kept. */
export async function disableDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  const { id, expectedRevision } = claimOf(input);
  return mutate(async ({ tx, organizationId, siteId }) => {
    await disableDomain({ tx, organizationId }, siteId, id, expectedRevision);
  });
}

/** Release the domain. The claim stays as history, and the name can be claimed again with a new token. */
export async function removeDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  const { id, expectedRevision } = claimOf(input);
  return mutate(async ({ tx, organizationId, siteId }) => {
    await removeDomain({ tx, organizationId }, siteId, id, expectedRevision);
  });
}

/** Make an active domain the site's main address, or (`main: false`) make the Climvia address the main one again. */
export async function setMainDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  const { id, expectedRevision } = claimOf(input);
  const main = isRecord(input) && input.main === true;
  return mutate(async ({ tx, organizationId, siteId }) => {
    await setMainDomain({ tx, organizationId }, siteId, id, expectedRevision, main);
  });
}
