"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { MARKETING_DATA, type Campaign, type MarketingData } from "@/data/marketing";
import * as state from "@/lib/marketing-state";

type MarketingContextValue = {
  /** The working campaigns: the baseline sample plus any changes made in this session. */
  data: MarketingData;
  createDraft: (input: state.CampaignInput) => Campaign;
  updateCampaign: (id: string, input: state.CampaignInput) => void;
  saveAsDraft: (id: string, input: state.CampaignInput) => void;
  scheduleCampaign: (id: string, scheduledFor: string) => void;
  sendCampaign: (id: string) => void;
  cancelSchedule: (id: string) => void;
  duplicateCampaign: (id: string) => Campaign | undefined;
};

const MarketingContext = createContext<MarketingContextValue | null>(null);

/** In memory only; a reload restores the baseline. Nothing is delivered to anyone. */
export function MarketingProvider({ initial = MARKETING_DATA, children }: { initial?: MarketingData; children: ReactNode }) {
  const [data, setData] = useState<MarketingData>(initial);
  const latest = useRef(data);

  const commit = useCallback((next: MarketingData) => {
    latest.current = next;
    setData(next);
  }, []);

  const value = useMemo<MarketingContextValue>(
    () => ({
      data,
      // The ref lets actions that return a value read the latest data synchronously.
      createDraft: (input) => {
        const result = state.createDraft(latest.current, input);
        commit(result.data);
        return result.campaign;
      },
      updateCampaign: (id, input) => commit(state.updateCampaign(latest.current, id, input)),
      saveAsDraft: (id, input) => commit(state.saveAsDraft(latest.current, id, input)),
      scheduleCampaign: (id, scheduledFor) => commit(state.scheduleCampaign(latest.current, id, scheduledFor)),
      sendCampaign: (id) => commit(state.sendCampaign(latest.current, id)),
      cancelSchedule: (id) => commit(state.cancelSchedule(latest.current, id)),
      duplicateCampaign: (id) => {
        const result = state.duplicateCampaign(latest.current, id);
        commit(result.data);
        return result.campaign;
      },
    }),
    [data, commit],
  );

  return <MarketingContext value={value}>{children}</MarketingContext>;
}

export function useMarketing(): MarketingContextValue {
  const context = useContext(MarketingContext);
  if (!context) throw new Error("useMarketing must be used inside <MarketingProvider>.");
  return context;
}
