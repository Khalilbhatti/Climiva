"use client";

import { Mail, MapPin, Phone } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { US_STATES, type BusinessAddress, type BusinessInfo } from "@/data/settings";
import { formatCityStateZip, getInitials, toTelHref } from "@/lib/format";
import { isSameBusiness, normalizeBusiness, validateBusiness } from "@/lib/settings-state";
import { AsidePanel, InfoNote, SettingsForm, useSettingsDraft } from "./SettingsForm";
import { useSettings } from "./SettingsProvider";

/** Settings → Business information: the one place the business's name, phone, email and address are edited. */
export function BusinessInformationForm() {
  const { settings, saveBusiness } = useSettings();
  const { toast } = useToast();
  const { canEditSettings } = useWorkspace();
  const saved = settings.business;
  const { draft, setDraft, dirty, showErrors, setShowErrors, problem, setProblem, guard, discard } = useSettingsDraft<BusinessInfo>(saved, isSameBusiness, "business information");

  const errors = validateBusiness(draft);
  const shown = showErrors ? errors : {};
  const setAddress = (patch: Partial<BusinessAddress>) => setDraft({ ...draft, address: { ...draft.address, ...patch } });

  async function save() {
    setProblem(undefined);
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return false;
    }
    const next = normalizeBusiness(draft);
    const result = await saveBusiness(next);
    if (!result.ok) {
      setProblem(result.error);
      return true;
    }
    // Show the tidied values (for example the phone number in one format) so the form matches what was saved.
    setDraft(next);
    setShowErrors(false);
    toast("Business information saved.");
    return true;
  }

  return (
    <SettingsForm
      title="Business information"
      description="Manage the business details used across your Climvia workspace and customer-facing experiences."
      what="business information"
      dirty={dirty}
      saveLabel="Save changes"
      onSave={save}
      problem={problem}
      readOnly={!canEditSettings}
      onDiscard={() => discard()}
      guard={guard}
      aside={<BusinessDetails business={saved} />}
    >
      <Input
        label="Business name"
        required
        autoComplete="organization"
        maxLength={80}
        hint="Used as your business name throughout Climvia."
        value={draft.name}
        error={shown.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Phone"
          required
          type="tel"
          autoComplete="tel"
          hint="Used where your business phone is shown to customers."
          value={draft.phone}
          error={shown.phone}
          onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
        />
        <Input
          label="Email"
          required
          type="email"
          autoComplete="email"
          hint="Used as the primary public business email."
          value={draft.email}
          error={shown.email}
          onChange={(event) => setDraft({ ...draft, email: event.target.value })}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">Business address</legend>
        <Input
          label="Street address"
          required
          autoComplete="address-line1"
          value={draft.address.street}
          error={shown.street}
          onChange={(event) => setAddress({ street: event.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
          <Input
            label="City"
            required
            autoComplete="address-level2"
            value={draft.address.city}
            error={shown.city}
            onChange={(event) => setAddress({ city: event.target.value })}
          />
          <Select
            label="State"
            required
            autoComplete="address-level1"
            value={draft.address.state}
            error={shown.state}
            onChange={(event) => setAddress({ state: event.target.value })}
          >
            <option value="">Select</option>
            {US_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
          <Input
            label="ZIP code"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            value={draft.address.postalCode}
            error={shown.postalCode}
            onChange={(event) => setAddress({ postalCode: event.target.value })}
          />
        </div>
      </fieldset>

      <InfoNote>Connected Climvia features use these business details where applicable.</InfoNote>
    </SettingsForm>
  );
}

/** What is saved right now, as the rest of the workspace and the customer-facing pages read it. */
function BusinessDetails({ business }: { business: BusinessInfo }) {
  return (
    <AsidePanel title="Business details">
      <div className="rounded-card bg-surface-low p-4">
        <div className="flex items-center gap-3 border-b border-line pb-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-primary text-sm font-bold text-white">
            {getInitials(business.name)}
          </span>
          <p className="text-sm font-bold text-ink">{business.name}</p>
        </div>
        <ul className="mt-3 space-y-2 text-sm text-ink">
          <li className="flex items-start gap-2">
            <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <a href={toTelHref(business.phone)} className="hover:underline">
              {business.phone}
            </a>
          </li>
          <li className="flex items-start gap-2">
            <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <a href={`mailto:${business.email}`} className="break-all hover:underline">
              {business.email}
            </a>
          </li>
          <li className="flex items-start gap-2">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              {business.address.street}, {formatCityStateZip(business.address)}
            </span>
          </li>
        </ul>
      </div>
    </AsidePanel>
  );
}
