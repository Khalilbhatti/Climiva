"use client";

import Link from "next/link";
import { ChevronsUpDown, Store } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useSettings } from "@/components/settings/SettingsProvider";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationsMenu } from "./NotificationsMenu";

export function TopBar() {
  // The workspace name and the signed-in user are the saved Settings, so an edit shows here at once.
  const { business, profile } = useSettings().settings;
  return (
    <header className="sticky top-0 z-30 flex h-(--topbar-height) items-center justify-between border-b border-line bg-surface px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-3 lg:gap-6">
        <Link href="/" aria-label="Climvia — Workspace Overview" className="flex shrink-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-btn bg-primary text-base font-bold tracking-tight text-white shadow-card"
          >
            C
          </span>
          <span className="text-lg font-bold tracking-tight text-ink">Climvia</span>
        </Link>

        {/* Single workspace for now; the switcher opens workspace settings, as in the approved Stitch frame. */}
        <Link
          href="/settings"
          title="Workspace settings"
          className="flex min-w-0 max-w-72 items-center gap-2.5 rounded-btn border border-line px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
        >
          <Store aria-hidden className="size-[18px] shrink-0 text-primary" />
          <span className="truncate">{business.name}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
        </Link>
      </div>

      <GlobalSearch />

      <div className="flex shrink-0 items-center gap-3 lg:gap-4">
        <NotificationsMenu />

        <div aria-hidden className="h-6 w-px bg-line" />

        <Link href="/settings" aria-label={`${profile.name}, ${profile.role}`} className="flex items-center gap-3">
          <Avatar name={profile.name} src={profile.photo} />
          <span className="hidden text-left whitespace-nowrap lg:block">
            <span className="block text-sm leading-tight font-semibold text-ink">{profile.name}</span>
            <span className="block text-mini leading-tight text-ink-muted">{profile.role}</span>
          </span>
        </Link>
      </div>
    </header>
  );
}
