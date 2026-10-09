"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_ACCENT,
  getTimeZone,
  type Branding,
  type BusinessInfo,
  type Preferences,
  type Profile,
  type SettingsData,
  type WeeklyHours,
} from "@/data/settings";
import { DEFAULT_DISPLAY_PREFERENCES, setDisplayPreferences } from "@/lib/display-preferences";
import type { ActionResult } from "@/lib/action-result";
import * as state from "@/lib/settings-state";
import { saveBusinessAction, saveHoursAction, savePreferencesAction, saveProfileAction } from "@/server/actions/settings";

/** What a save reports back to its form. A failure carries the words to show; the working copy is unchanged. */
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

type SettingsContextValue = {
  /** The working settings: what is stored for the active workspace (and, for branding, this session's edits). */
  settings: SettingsData;
  saveBusiness: (business: BusinessInfo) => Promise<SaveResult>;
  saveHours: (hours: WeeklyHours) => Promise<SaveResult>;
  savePreferences: (preferences: Preferences) => Promise<SaveResult>;
  saveProfile: (profile: Profile) => Promise<SaveResult>;
  /** Branding is not stored yet (a logo needs file storage); it lasts for the session only. */
  saveBranding: (branding: Branding) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Runs a server action; if the server cannot be reached the person gets words to read, not an uncaught error. */
async function send<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: "We couldn't reach the server, so nothing was saved. Check your connection and try again." };
  }
}

/**
 * The one editable copy of the business identity and workspace preferences, for the active workspace.
 *
 * `initial` is what the server read from PostgreSQL for this page load. A save goes to the server, which validates it
 * again and stores it for the active workspace; only when that succeeds does the working copy change, so what is on
 * screen is never ahead of what is stored. Mounted around the whole workspace and the customer-facing previews, so they
 * read what was saved inside it.
 */
export function SettingsProvider({ initial, children }: { initial: SettingsData; children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsData>(initial);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const latest = useRef(settings);

  const commit = useCallback((next: SettingsData) => {
    // Date and time formatters read their style from lib/display-preferences, so it is updated with the state.
    setDisplayPreferences({ dateFormat: next.preferences.dateFormat, timeFormat: next.preferences.timeFormat });
    latest.current = next;
    setSettings(next);
  }, []);

  // The formatters are plain functions with module-level state, which the server must never write (it serves many
  // workspaces at once). So the first render, on the server and in the browser, uses the default style and hydration
  // agrees. Once mounted, a workspace with a different saved style applies it and remounts the tree beneath once.
  useEffect(() => {
    const saved = initial.preferences;
    if (saved.dateFormat === DEFAULT_DISPLAY_PREFERENCES.dateFormat && saved.timeFormat === DEFAULT_DISPLAY_PREFERENCES.timeFormat) return;
    setDisplayPreferences({ dateFormat: saved.dateFormat, timeFormat: saved.timeFormat });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remount is the point: it re-renders every date in the saved style
    setStyleEpoch(1);
  }, [initial.preferences]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      saveBusiness: async (business) => {
        const result = await send(() => saveBusinessAction(business));
        if (!result.ok) return result;
        commit(state.saveBusiness(latest.current, result.data));
        return { ok: true };
      },
      saveHours: async (hours) => {
        const result = await send(() => saveHoursAction(hours));
        if (!result.ok) return result;
        commit(state.saveHours(latest.current, result.data));
        return { ok: true };
      },
      savePreferences: async (preferences) => {
        const result = await send(() => savePreferencesAction(preferences));
        if (!result.ok) return result;
        commit(state.savePreferences(latest.current, result.data));
        return { ok: true };
      },
      saveProfile: async (profile) => {
        // Only the name is stored; a chosen photo is shown for this session (it needs file storage to be kept).
        const result = await send(() => saveProfileAction(profile.name));
        if (!result.ok) return result;
        commit(state.saveProfile(latest.current, { ...profile, name: result.data.name }));
        return { ok: true };
      },
      saveBranding: (branding) => commit(state.saveBranding(latest.current, branding)),
    }),
    [settings, commit],
  );

  return (
    <SettingsContext value={value}>
      <Fragment key={styleEpoch}>{children}</Fragment>
    </SettingsContext>
  );
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
