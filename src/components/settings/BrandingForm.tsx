"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fieldClasses } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ACCENT_SWATCHES, DEFAULT_ACCENT, type Branding, type BrandLogo } from "@/data/settings";
import { checkLogoFile, LOGO_ACCEPT_ATTRIBUTE, UPLOAD_FAILURES } from "@/lib/asset-rules";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/format";
import { normalizeAccent, validateAccent } from "@/lib/settings-state";
import { AsidePanel, SettingsForm, useSettingsDraft } from "./SettingsForm";
import { useSettings, type LogoChoice } from "./SettingsProvider";

/**
 * The accent is edited as text so a half-typed value is not rejected; it is read back as a colour on save. A logo the person has just chosen
 * is a `file` and a local preview (`logo.src` is a browser object URL) until it is saved: the server stores it, and what the form shows after
 * that is the stored logo. The `file` is what is sent; nothing in the draft is ever what a page of the website draws.
 */
type BrandingDraft = { logo: BrandLogo | null; file: File | null; accentInput: string };

const toDraft = (branding: Branding): BrandingDraft => ({ logo: branding.logo, file: null, accentInput: branding.accent ?? "" });

function isSameDraft(draft: BrandingDraft, saved: BrandingDraft): boolean {
  const accent = normalizeAccent(draft.accentInput);
  const sameAccent = accent === undefined ? draft.accentInput.trim() === saved.accentInput : accent === normalizeAccent(saved.accentInput);
  return sameAccent && draft.file === null && draft.logo?.src === saved.logo?.src;
}

/** The logo as a tile. */
function LogoTile({ logo, size }: { logo: BrandLogo; size: string }) {
  return (
    <span aria-hidden className={cn("flex items-center justify-center overflow-hidden rounded-card bg-surface ring-1 ring-line", size)}>
      {/* The stored logo (or, before it is saved, a local preview of the chosen file), so there is nothing for next/image to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.src} alt="" className="size-full object-contain" />
    </span>
  );
}

/** Settings → Branding: the business logo (with its initials fallback) and an optional accent for customer-facing pages. */
export function BrandingForm() {
  const { settings, saveBranding } = useSettings();
  const { toast } = useToast();
  const { canEditSettings } = useWorkspace();
  const saved = settings.branding;
  const businessName = settings.business.name;
  const { draft, setDraft, dirty, showErrors, setShowErrors, problem, setProblem, guard, discard } = useSettingsDraft<BrandingDraft>(
    toDraft(saved),
    isSameDraft,
    "branding",
  );
  const [logoError, setLogoError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const accent = normalizeAccent(draft.accentInput);
  const accentError = validateAccent(draft.accentInput);

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // A first look, so an obvious mistake is told at once. The server reads the file itself and decides.
    const refused = checkLogoFile(file);
    if (refused) {
      setLogoError(UPLOAD_FAILURES[refused]);
      return;
    }
    setLogoError(undefined);
    releaseDraftLogo();
    // The preview is an object URL: it lives in this browser only, is never saved, and is never shown to a visitor.
    setDraft({ ...draft, file, logo: { fileName: file.name, src: URL.createObjectURL(file) } });
  }

  /** A file chosen but not saved has no other owner, so its object URL is released when it is replaced, discarded or saved. */
  function releaseDraftLogo() {
    if (draft.file && draft.logo?.src) URL.revokeObjectURL(draft.logo.src);
  }

  function logoChoice(): LogoChoice {
    if (draft.file) return { kind: "replace", file: draft.file };
    return draft.logo === null && saved.logo !== null ? { kind: "remove" } : { kind: "keep" };
  }

  async function save() {
    setProblem(undefined);
    if (accentError) {
      setShowErrors(true);
      return false;
    }
    const result = await saveBranding(accent ?? null, logoChoice());
    if (!result.ok) {
      setProblem(result.error);
      return true;
    }
    releaseDraftLogo();
    setLogoError(undefined);
    setDraft(toDraft(result.branding));
    setShowErrors(false);
    toast("Branding saved.");
    return true;
  }

  return (
    <SettingsForm
      title="Branding"
      description="Manage the core business identity used across supported Climvia customer-facing experiences. Your saved branding may appear in supported customer-facing Climvia experiences."
      what="branding"
      dirty={dirty}
      saveLabel="Save branding"
      onSave={save}
      problem={problem}
      readOnly={!canEditSettings}
      onDiscard={() =>
        discard(() => {
          releaseDraftLogo();
          setLogoError(undefined);
        })
      }
      guard={guard}
      aside={<BrandIdentity branding={saved} businessName={businessName} />}
    >
      <section aria-labelledby="logo-heading" className="space-y-4">
        <div>
          <h3 id="logo-heading" className="text-base font-semibold text-ink">
            Business logo
          </h3>
          <p className="mt-0.5 text-sm text-ink-muted">Recommended high-resolution PNG with transparent backing. PNG, JPG or WebP.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card bg-surface-low p-4">
            <p className="text-micro font-semibold tracking-wider text-primary uppercase">Logo</p>
            <div className="mt-3 flex flex-col items-center gap-2 text-center">
              {draft.logo ? (
                <>
                  <LogoTile logo={draft.logo} size="size-20" />
                  <p className="text-xs break-all text-ink-muted">{draft.logo.fileName}</p>
                </>
              ) : (
                <p className="py-6 text-sm text-ink-muted">No logo. The initials below are shown instead.</p>
              )}
            </div>
          </div>
          <div className="rounded-card bg-surface-low p-4">
            <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">Logo fallback</p>
            <div className="mt-3 flex flex-col items-center gap-2 text-center">
              <span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-line text-xl font-bold text-primary">
                {getInitials(businessName)}
              </span>
              <p className="text-xs text-ink-muted">Used when no business logo is available.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept={LOGO_ACCEPT_ATTRIBUTE}
            aria-label="Choose a logo file"
            className="sr-only"
            tabIndex={-1}
            onChange={chooseLogo}
          />
          <Button onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden className="size-4" />
            {draft.logo ? "Change logo" : "Add logo"}
          </Button>
          {draft.logo && (
            <Button
              variant="destructive"
              onClick={() => {
                releaseDraftLogo();
                setLogoError(undefined);
                setDraft({ ...draft, file: null, logo: null });
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              Remove logo
            </Button>
          )}
          <span className="ml-auto text-xs text-ink-muted">Max size: 5MB</span>
        </div>
        {logoError && (
          <p role="alert" className="text-xs text-danger">
            {logoError}
          </p>
        )}
      </section>

      <section aria-labelledby="accent-heading" className="space-y-3 border-t border-line pt-6">
        <div>
          <h3 id="accent-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
            Brand accent
            <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-medium text-ink-muted">Optional</span>
          </h3>
          <p className="mt-0.5 text-sm text-ink-muted">
            Used for subtle accent highlights in supported customer-facing experiences. The Climvia workspace itself is not recoloured.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden
            className="size-10 shrink-0 rounded-btn border border-line"
            style={{ backgroundColor: accent ?? DEFAULT_ACCENT }}
          />
          <div className="w-44">
            <label htmlFor="brand-accent" className="mb-1 block text-xs font-medium text-ink">
              HEX
            </label>
            <input
              id="brand-accent"
              value={draft.accentInput}
              onChange={(event) => setDraft({ ...draft, accentInput: event.target.value })}
              placeholder={DEFAULT_ACCENT}
              spellCheck={false}
              autoComplete="off"
              maxLength={7}
              aria-invalid={showErrors && accentError ? true : undefined}
              aria-describedby={showErrors && accentError ? "brand-accent-error" : "brand-accent-hint"}
              className={cn(fieldClasses, "font-mono", showErrors && accentError && "border-danger")}
            />
          </div>
          <div role="group" aria-label="Accent colours" className="flex items-center gap-2">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Use ${swatch}`}
                aria-pressed={accent === swatch}
                onClick={() => setDraft({ ...draft, accentInput: swatch })}
                style={{ backgroundColor: swatch }}
                className={cn("size-8 rounded-btn border-2 border-white ring-1 ring-line", accent === swatch && "ring-2 ring-ink")}
              />
            ))}
          </div>
        </div>
        {showErrors && accentError ? (
          <p id="brand-accent-error" className="text-xs text-danger">
            {accentError}
          </p>
        ) : (
          <p id="brand-accent-hint" className="text-xs text-ink-muted">
            Leave empty to keep the Climvia teal.
          </p>
        )}
      </section>
    </SettingsForm>
  );
}

/** What is saved right now, as customer-facing pages use it. */
function BrandIdentity({ branding, businessName }: { branding: Branding; businessName: string }) {
  return (
    <AsidePanel title="Brand identity" description="Summary of business identity elements currently configured for your workspace.">
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-card bg-surface-low p-3">
          {branding.logo ? (
            <LogoTile logo={branding.logo} size="size-10" />
          ) : (
            <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-line text-sm font-bold text-primary">
              {getInitials(businessName)}
            </span>
          )}
          <div>
            <p className="text-sm font-bold text-ink">{businessName}</p>
            <p className="text-xs text-ink-muted">Logo: {branding.logo ? "Active" : "Not set"}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-card bg-surface-low p-3 text-sm">
          <span className="flex items-center gap-2 text-ink">
            <span aria-hidden className="size-4 rounded-full border border-line" style={{ backgroundColor: branding.accent ?? DEFAULT_ACCENT }} />
            Brand accent
          </span>
          <span className="font-mono text-xs text-ink-muted">{branding.accent ?? "Default"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-card bg-surface-low p-3 text-sm">
          <span className="text-ink">Initials fallback</span>
          <span className="rounded bg-line px-2 py-0.5 text-xs font-bold text-primary">{getInitials(businessName)}</span>
        </div>
      </div>
    </AsidePanel>
  );
}
