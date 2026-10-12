"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CampaignInput, CampaignStatus, MarketingData, SendTiming } from "@/data/marketing";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { cancelScheduleAction, duplicateCampaignAction, saveDraftAction, scheduleCampaignAction, sendCampaignAction } from "@/server/actions/marketing";

/** What every change resolves with: the campaigns as stored and the reference of the one just changed, or why it was refused. */
type Done = Promise<ActionResult<{ marketing: MarketingData; reference: string }>>;

/** Which campaign a change is about, and the status the screen saw it in. A new campaign has no target. */
export type CampaignTarget = { id: string; status: Exclude<CampaignStatus, "sent"> } | undefined;

type MarketingContextValue = {
  /** The business's campaigns, as stored. Their recipients are not here: a page asks the server for one campaign's at a time. */
  data: MarketingData;
  /** Saves a campaign as a Draft: a new one, or an existing one (saving a Scheduled campaign as a draft cancels its send). */
  saveDraft: (target: CampaignTarget, campaign: CampaignInput) => Done;
  /** Schedules a campaign for the business's local date and time. */
  scheduleCampaign: (target: CampaignTarget, campaign: CampaignInput, timing: Extract<SendTiming, { mode: "later" }>) => Done;
  /** Records a campaign as sent now. Nothing is delivered. */
  sendCampaign: (target: CampaignTarget, campaign: CampaignInput) => Done;
  /** Cancels a scheduled send: the campaign is a Draft again. */
  cancelSchedule: (id: string) => Done;
  /** A new Draft from any campaign. */
  duplicateCampaign: (id: string) => Done;
};

const MarketingContext = createContext<MarketingContextValue | null>(null);

const targetFields = (target: CampaignTarget) => (target ? { id: target.id, expectedStatus: target.status } : {});

/**
 * The business's Marketing campaigns for the whole workspace. `initial` is what the server read from PostgreSQL for this page
 * load, for the ACTIVE organization only. Every change goes to the server, which authorizes it (owner or admin), validates it,
 * stores it in one transaction (taking the recipient snapshot when a campaign is scheduled or sent) and answers with the campaigns
 * as stored; only then does the working copy change, so the screen is never ahead of the database. Nothing is delivered to anyone.
 */
export function MarketingProvider({ initial, children }: { initial: MarketingData; children: ReactNode }) {
  const [data, setData] = useState<MarketingData>(initial);

  const adopt = useCallback((result: ActionResult<{ marketing: MarketingData; reference: string }>) => {
    if (result.ok) setData(result.data.marketing);
    return result;
  }, []);

  const value = useMemo<MarketingContextValue>(
    () => ({
      data,
      saveDraft: async (target, campaign) => adopt(await send(() => saveDraftAction({ ...targetFields(target), campaign }))),
      scheduleCampaign: async (target, campaign, timing) => adopt(await send(() => scheduleCampaignAction({ ...targetFields(target), campaign, timing }))),
      sendCampaign: async (target, campaign) => adopt(await send(() => sendCampaignAction({ ...targetFields(target), campaign }))),
      cancelSchedule: async (id) => adopt(await send(() => cancelScheduleAction({ id }))),
      duplicateCampaign: async (id) => adopt(await send(() => duplicateCampaignAction({ id }))),
    }),
    [data, adopt],
  );

  return <MarketingContext value={value}>{children}</MarketingContext>;
}

export function useMarketing(): MarketingContextValue {
  const context = useContext(MarketingContext);
  if (!context) throw new Error("useMarketing must be used inside <MarketingProvider>.");
  return context;
}
