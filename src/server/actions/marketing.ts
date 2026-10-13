"use server";

import { PROTOTYPE_NOW } from "@/lib/prototype-clock";
import type { CampaignStatus, MarketingData } from "@/data/marketing";
import { cancelScheduleTx, duplicateTx, loadMarketing, saveDraftTx, scheduleTx, sendTx, type MarketingContext } from "@/db/marketing-queries";
import { loadRefs } from "@/db/ops-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_MARKETING, failure, ok, type ActionResult } from "@/lib/action-result";
import { stampInstant } from "@/lib/business-time";
import { SENT_CAMPAIGN, STALE_CAMPAIGN, campaignRef, localMoment, parseCampaignContent, parseTiming } from "@/lib/marketing-rules";
import { Refusal, refuse } from "@/lib/refusal";
import { isRecord, type Parsed } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Marketing writes: save a campaign as a Draft, schedule it, send it (record it as sent), cancel its schedule, duplicate it. Each
 * action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "marketing:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement), including the send time in the business's own time zone,
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, locks the campaign row, resolves
 *      every reference it names (the campaign, the customers) INSIDE the verified organization and checks the status the screen
 *      saw is still the campaign's status (a stale screen, a double click or a second person changes nothing twice),
 *   5. writes, reads the business's campaigns back and answers with them, so the screen shows exactly what is stored.
 * No argument names an organization. Nothing is delivered anywhere: "sent" is a recorded state and the recipients are a snapshot of
 * the audience at that moment. A Sent campaign is final.
 */

type Answer = { marketing: MarketingData; reference: string };

function valid<T>(parsed: Parsed<T>): T {
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "campaigns_final") return failure(SENT_CAMPAIGN);
  if (constraint === "campaigns_org_slug_unique" || uniqueViolationOf(error)) return failure("Someone changed this at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[marketing] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

/** Authorize, open the tenant transaction, run the change, and answer with the campaigns as stored. */
async function mutate(change: (ctx: MarketingContext) => Promise<string>): Promise<ActionResult<Answer>> {
  const auth = await authorize("marketing:manage", NOT_ALLOWED_MARKETING);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const refs = await loadRefs(tx, organizationId);
      const reference = await change({
        tx,
        organizationId,
        timeZone: organization.timezone,
        refs,
        clock: snapshot.clock,
        stamp: stampInstant(snapshot.hasSampleData, organization.timezone, PROTOTYPE_NOW),
        actorUserId: userId,
      });
      return ok({ marketing: await loadMarketing(tx, organizationId, organization.timezone, refs), reference });
    });
  } catch (error) {
    return translate(error);
  }
}

/**
 * Which campaign a request is about, and the status the screen saw it in. A new campaign has neither. An existing one must name
 * both: a request without the status it expects cannot be told from a stale one, so it is not understood.
 */
function targetOf(input: Record<string, unknown>): { slug: string; expected: CampaignStatus } | undefined {
  if (input.id === undefined || input.id === null) return undefined;
  const slug = campaignRef(input.id);
  if (!slug) return refuse("The campaign was not understood.");
  if (input.expectedStatus === "sent") return refuse(SENT_CAMPAIGN);
  if (input.expectedStatus !== "draft" && input.expectedStatus !== "scheduled") return refuse(STALE_CAMPAIGN);
  return { slug, expected: input.expectedStatus };
}

function body(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : refuse("The campaign was not understood.");
}

/* ───────────────────────── saving ───────────────────────── */

/** Save a campaign as a Draft: a new one, or an existing Draft (saving a Scheduled campaign as a draft cancels its send). */
export async function saveDraftAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const request = body(input);
    return saveDraftTx(ctx, targetOf(request), valid(parseCampaignContent(request.campaign, "draft")));
  });
}

/** Schedule a campaign for a business-local date and time: resolves the audience, stores the recipient snapshot and the count. */
export async function scheduleCampaignAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const request = body(input);
    const target = targetOf(request);
    const content = valid(parseCampaignContent(request.campaign, "complete"));
    const timing = valid(parseTiming(request.timing, ctx.clock));
    if (timing.mode !== "later") return refuse("Choose when to send this campaign.");
    return scheduleTx(ctx, target, content, localMoment(timing));
  });
}

/** Record a campaign as sent now, with the snapshot of who it went to. Nothing is delivered. */
export async function sendCampaignAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const request = body(input);
    return sendTx(ctx, targetOf(request), valid(parseCampaignContent(request.campaign, "complete")));
  });
}

/* ───────────────────────── cancelling and copying ───────────────────────── */

/** Cancel a scheduled send: the campaign is a Draft again. It is never deleted. */
export async function cancelScheduleAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const slug = campaignRef(body(input).id) ?? refuse("The campaign was not understood.");
    return cancelScheduleTx(ctx, slug);
  });
}

/** A new Draft from any campaign, sent ones included. The original is untouched. */
export async function duplicateCampaignAction(input: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const slug = campaignRef(body(input).id) ?? refuse("The campaign was not understood.");
    return duplicateTx(ctx, slug);
  });
}
