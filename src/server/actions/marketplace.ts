"use server";

import type { MarketplaceState } from "@/data/marketplace";
import { loadServices } from "@/db/core-queries";
import type { Tx } from "@/db/index";
import { loadMarketplace, saveListing, setListingStatus } from "@/db/marketplace-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_MARKETPLACE, failure, ok, type ActionResult } from "@/lib/action-result";
import { parseListingConfig } from "@/lib/marketplace-rules";
import { Refusal, refuse } from "@/lib/refusal";
import { isRecord } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation } from "../db-errors";

/**
 * Marketplace writes: save the listing, set it up (save and publish), publish it, hide it. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "marketplace:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement),
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, locks the listing, resolves every Service
 *      it selects INSIDE the verified organization (another business's Service is "not in your catalog") and writes,
 *   5. answers with the listing as stored.
 * No argument names an organization or a listing: the listing is the verified organization's own.
 */

type Answer = { marketplace: MarketplaceState };

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "marketplace_listing_services_public") return failure("Only active, public Services can be shown on a listing.", { services: "Only active, public Services can be shown on a listing." });
  if (constraint === "marketplace_listings_public_slug_unique" || constraint === "marketplace_listings_org_unique") return failure("Someone changed this at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[marketplace] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

type Work = { tx: Tx; organizationId: string; organizationSlug: string };

async function mutate(change: (work: Work) => Promise<void>): Promise<ActionResult<Answer>> {
  const auth = await authorize("marketplace:manage", NOT_ALLOWED_MARKETPLACE);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      await change({ tx, organizationId, organizationSlug: organization.slug });
      return ok({ marketplace: await loadMarketplace(tx, organizationId, await loadServices(tx, organizationId)) });
    });
  } catch (error) {
    return translate(error);
  }
}

function config(input: unknown) {
  const request = isRecord(input) ? input : refuse("The listing details were not understood.");
  const parsed = parseListingConfig(request.config);
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

/** Save the listing's configuration. The published or hidden status is unchanged. */
export async function saveListingAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (work) => saveListing(work, config(input), { publish: false }));
}

/** First-time setup: save the configuration and publish the listing in one step. */
export async function setUpListingAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (work) => saveListing(work, config(input), { publish: true }));
}

/** Publish a saved listing again. */
export async function publishListingAction(): Promise<ActionResult<Answer>> {
  return mutate(async (work) => setListingStatus(work, "published"));
}

/** Hide the listing from the directory. Its configuration stays exactly as it was. */
export async function hideListingAction(): Promise<ActionResult<Answer>> {
  return mutate(async (work) => setListingStatus(work, "hidden"));
}
