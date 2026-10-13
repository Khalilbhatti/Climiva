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
import { UPLOAD_FAILURES } from "@/lib/asset-rules";
import { send, UNREACHABLE } from "@/lib/send-action";
import * as state from "@/lib/settings-state";
import { saveBusinessAction, saveHoursAction, savePreferencesAction, saveProfileAction } from "@/server/actions/settings";

/** What a save reports back to its form. A failure carries the words to show; the working copy is unchanged. */
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

/** What saving the Branding does to the logo: leaves it, takes it away, or replaces it with this file. */
export type LogoChoice = { kind: "keep" } | { kind: "remove" } | { kind: "replace"; file: File };

type SettingsContextValue = {
  /** The working settings: what is stored for the active workspace. */
  settings: SettingsData;
  saveBusiness: (business: BusinessInfo) => Promise<SaveResult>;
  saveHours: (hours: WeeklyHours) => Promise<SaveResult>;
  savePreferences: (preferences: Preferences) => Promise<SaveResult>;
  saveProfile: (profile: Profile) => Promise<SaveResult>;
  /** Save the Branding: the accent, and what happens to the logo. The file goes to the server, which stores it; only a stored logo is ever shown. */
  saveBranding: (accent: string | null, logo: LogoChoice) => Promise<{ ok: true; branding: Branding } | { ok: false; error: string }>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

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
      saveBranding: async (accent, logo) => {
        const form = new FormData();
        form.set("accent", accent ?? "");
        if (logo.kind === "replace") form.set("logo", logo.file, logo.file.name);
        if (logo.kind === "remove") form.set("removeLogo", "1");
        let response: Response;
        try {
          response = await fetch("/api/branding", { method: "POST", body: form, credentials: "same-origin" });
        } catch {
          return { ok: false, error: UNREACHABLE };
        }
        const body: unknown = await response.json().catch(() => null);
        const saved = typeof body === "object" && body !== null && "branding" in body ? readBranding(body.branding) : null;
        if (response.ok && saved) {
          commit(state.saveBranding(latest.current, saved));
          return { ok: true, branding: saved };
        }
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : UPLOAD_FAILURES.failed;
        return { ok: false, error: message };
      },
    }),
    [settings, commit],
  );

  return (
    <SettingsContext value={value}>
      <Fragment key={styleEpoch}>{children}</Fragment>
    </SettingsContext>
  );
}

/** The Branding the server answered with, or null when it does not look like one. */
function readBranding(value: unknown): Branding | null {
  if (typeof value !== "object" || value === null || !("accent" in value) || !("logo" in value)) return null;
  const { accent, logo } = value as { accent: unknown; logo: unknown };
  if (accent !== null && typeof accent !== "string") return null;
  if (logo === null) return { logo: null, accent };
  if (typeof logo !== "object" || !("fileName" in logo) || !("src" in logo)) return null;
  const { fileName, src } = logo as { fileName: unknown; src: unknown };
  return typeof fileName === "string" && typeof src === "string" ? { logo: { fileName, src }, accent } : null;
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
