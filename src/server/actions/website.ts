"use server";

import type { WebsiteState } from "@/data/website";
import { DEFAULT_TEMPLATE_KEY } from "@/db/default-template";
import type { Tx } from "@/db/index";
import {
  connectCustomDomain,
  createDraftFromTemplate,
  findPrimarySite,
  loadWebsiteState,
  publishSite,
  removeCustomDomain,
  saveDraftPage,
  saveServiceDisplay,
  setPrimaryAddress,
  unpublishSite,
} from "@/db/site-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_WEBSITE, failure, ok, type ActionResult } from "@/lib/action-result";
import { Refusal, refuse } from "@/lib/refusal";
import { isRecord } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation } from "../db-errors";

/**
 * Website writes: create the website, save a page of the Draft, publish, unpublish, and the domain record. Each action:
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

type Answer = { website: WebsiteState | null; versionNumber?: number };

type Work = { tx: Tx; organizationId: string; siteId: string; userId: string };

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "sites_custom_domain_verified_unique") return failure("That domain can't be used for this website.", { domain: "That domain can't be used for this website." });
  if (constraint === "site_published_final") return failure("A published version can't be changed. Edit the draft and publish it again.");
  if (constraint === "site_versions_one_draft") return failure("This website already has a draft. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[website] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
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
      return ok({ website: fresh ? await loadWebsiteState(tx, organizationId, fresh) : null, ...extra });
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

/** Save one page of the Draft: its sections' text and visibility, and (on the Services page) which Services the site shows. */
export async function savePageAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    if (!isRecord(input) || typeof input.page !== "string" || !isRecord(input.sections)) return refuse("The page was not understood.");
    const sections: Record<string, { visible: boolean; props: unknown }> = {};
    for (const [key, value] of Object.entries(input.sections)) {
      if (!isRecord(value)) return refuse("The page was not understood.");
      sections[key] = { visible: value.visible as boolean, props: value.props };
    }
    await saveDraftPage({ tx, organizationId }, siteId, input.page, { sections });
    if (input.serviceDisplay !== undefined) await saveServiceDisplay({ tx, organizationId }, siteId, input.serviceDisplay);
  });
}

/* ───────────────────────── publishing ───────────────────────── */

/** Publish the Draft: a new immutable Published version, and the site points at it. Nothing to publish is not an error. */
export async function publishWebsiteAction(): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId, userId }) => {
    const published = await publishSite({ tx, organizationId }, siteId, userId);
    return { versionNumber: published.number };
  });
}

/** Make the website private. Its pages, content and versions are kept. */
export async function unpublishWebsiteAction(): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    await unpublishSite({ tx, organizationId }, siteId);
  });
}

/* ───────────────────────── the domain record ───────────────────────── */

/** Record a custom domain. Nothing is verified or routed; it is kept as pending verification. */
export async function connectDomainAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    if (!isRecord(input)) return refuse("The domain was not understood.");
    await connectCustomDomain({ tx, organizationId }, siteId, input.domain);
  });
}

/** Choose which address is the main one: the Climvia address, or the recorded custom domain. */
export async function setPrimaryAddressAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    if (!isRecord(input)) return refuse("The address was not understood.");
    await setPrimaryAddress({ tx, organizationId }, siteId, input.primary);
  });
}

/** Remove the recorded custom domain. The Climvia address is main again; content and publishing are untouched. */
export async function removeDomainAction(): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, siteId }) => {
    await removeCustomDomain({ tx, organizationId }, siteId);
  });
}
