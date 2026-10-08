"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { ArrowRight, Info, Upload, UserCog } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { LOGO_TYPES, MAX_LOGO_BYTES, type Profile } from "@/data/settings";
import { isSameProfile, validateProfileName } from "@/lib/settings-state";
import { SettingsForm, useSettingsDraft } from "./SettingsForm";
import { useSettings } from "./SettingsProvider";

const PHOTO_ERROR = "Choose a PNG or JPG image up to 4 MB.";
const PHOTO_TYPES = LOGO_TYPES.filter((type) => type !== "image/svg+xml");

/**
 * Settings → My profile: how the signed-in user appears across the workspace. Display information only: there is no
 * email, password or sign-in here, and the role belongs to the Team record, so it is shown and not edited.
 */
export function ProfileForm() {
  const { settings, saveProfile } = useSettings();
  const { toast } = useToast();
  const saved = settings.profile;
  const { draft, setDraft, dirty, showErrors, setShowErrors, guard, discard } = useSettingsDraft<Profile>(saved, isSameProfile, "profile");
  const [photoError, setPhotoError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const nameError = validateProfileName(draft.name);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type) || file.size > MAX_LOGO_BYTES) {
      setPhotoError(PHOTO_ERROR);
      return;
    }
    setPhotoError(undefined);
    releaseDraftPhoto();
    setDraft({ ...draft, photo: URL.createObjectURL(file) });
  }

  /** A photo chosen but not saved has no other owner, so its object URL is released when it is replaced or discarded. */
  function releaseDraftPhoto() {
    if (draft.photo && draft.photo !== saved.photo) URL.revokeObjectURL(draft.photo);
  }

  function save() {
    if (nameError) {
      setShowErrors(true);
      return false;
    }
    saveProfile(draft);
    setDraft({ ...draft, name: draft.name.trim() });
    setShowErrors(false);
    toast("Profile updated.");
    return true;
  }

  return (
    <SettingsForm
      title="My profile"
      description="Manage your personal display information."
      what="profile"
      dirty={dirty}
      saveLabel="Save profile"
      onSave={save}
      onDiscard={() =>
        discard(() => {
          releaseDraftPhoto();
          setPhotoError(undefined);
        })
      }
      guard={guard}
    >
      <div className="flex flex-wrap items-center gap-4 rounded-card bg-surface-low p-4">
        <Avatar name={draft.name || saved.name} size="xl" src={draft.photo} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Profile photo</p>
          <p className="text-xs text-ink-muted">Used with your profile across the Climvia workspace.</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          aria-label="Choose a profile photo"
          className="sr-only"
          tabIndex={-1}
          onChange={choosePhoto}
        />
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden className="size-4" />
          Change photo
        </Button>
        {draft.photo && (
          <Button
            variant="tertiary"
            onClick={() => {
              releaseDraftPhoto();
              setDraft({ ...draft, photo: undefined });
            }}
          >
            Remove photo
          </Button>
        )}
      </div>
      {photoError && (
        <p role="alert" className="-mt-3 text-xs text-danger">
          {photoError}
        </p>
      )}

      <Input
        label="Full name"
        required
        autoComplete="name"
        maxLength={60}
        value={draft.name}
        error={showErrors ? nameError : undefined}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />

      <div>
        <p className="mb-1 text-xs font-medium text-ink">Role</p>
        <div className="flex items-center justify-between gap-3 rounded-btn border border-line bg-surface-low px-3 py-2">
          <span className="flex items-center gap-2.5 text-sm font-semibold text-ink">
            <span aria-hidden className="flex size-7 items-center justify-center rounded-btn bg-primary-subtle text-primary">
              <UserCog className="size-4" />
            </span>
            {saved.role}
          </span>
          <Link href="/team" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Manage Team
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
          <Info aria-hidden className="size-3.5" />
          Role access is managed with your Team record.
        </p>
      </div>
    </SettingsForm>
  );
}
