"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_ACCENT,
  getTimeZone,
  initialSettings,
  type Branding,
  type BusinessInfo,
  type Preferences,
  type Profile,
  type SettingsData,
  type WeeklyHours,
} from "@/data/settings";
import { setDisplayPreferences } from "@/lib/display-preferences";
import * as state from "@/lib/settings-state";

type SettingsContextValue = {
  /** The working settings: the canonical baseline plus any demo edits made in this session. */
  settings: SettingsData;
  saveBusiness: (business: BusinessInfo) => void;
  saveHours: (hours: WeeklyHours) => void;
  saveBranding: (branding: Branding) => void;
  savePreferences: (preferences: Preferences) => void;
  saveProfile: (profile: Profile) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * The one editable copy of the business identity and workspace preferences. Mounted at the app root so the Website and
 * Marketplace previews (outside the workspace shell) read what was saved inside it. In memory only: a reload restores
 * the baseline, which is the canonical Business and User records.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsData>(initialSettings);
  const latest = useRef(settings);

  const commit = useCallback((next: SettingsData) => {
    // Date and time formatters read their style from lib/display-preferences, so it is updated with the state.
    setDisplayPreferences({ dateFormat: next.preferences.dateFormat, timeFormat: next.preferences.timeFormat });
    latest.current = next;
    setSettings(next);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      saveBusiness: (business) => commit(state.saveBusiness(latest.current, business)),
      saveHours: (hours) => commit(state.saveHours(latest.current, hours)),
      saveBranding: (branding) => commit(state.saveBranding(latest.current, branding)),
      savePreferences: (preferences) => commit(state.savePreferences(latest.current, preferences)),
      saveProfile: (profile) => commit(state.saveProfile(latest.current, profile)),
    }),
    [settings, commit],
  );

  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside <SettingsProvider>.");
  return context;
}

/** The saved business name, phone, email and address. */
export function useBusiness(): BusinessInfo {
  return useSettings().settings.business;
}

/** The saved weekly hours as Monday-first rows ("Mon–Fri", "7:30 AM–6:00 PM"), in the saved time style. */
export function useHoursRows(): state.HoursRow[] {
  const { settings } = useSettings();
  const { hours, preferences } = settings;
  return useMemo(() => state.summarizeHours(hours, preferences.timeFormat), [hours, preferences.timeFormat]);
}

/** "Central Time (CT)" for the saved workspace time zone. */
export function useTimeZoneLabel(): string {
  return getTimeZone(useSettings().settings.preferences.timeZone).short;
}

/**
 * Inline custom properties that re-point the Climvia teal at the saved brand accent. Apply them only to a
 * customer-facing frame (the public preview pages, the listing and website pictures): the admin shell must keep its theme.
 */
export function useBrandStyle(): CSSProperties | undefined {
  const { accent } = useSettings().settings.branding;
  return useMemo(() => {
    if (!accent || accent === DEFAULT_ACCENT) return undefined;
    return {
      "--color-primary": accent,
      "--color-primary-hover": `color-mix(in srgb, ${accent} 80%, black)`,
      "--color-primary-subtle": `color-mix(in srgb, ${accent} 10%, white)`,
    } as CSSProperties;
  }, [accent]);
}
