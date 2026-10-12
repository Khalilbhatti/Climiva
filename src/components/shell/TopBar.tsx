"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, LogOut, Plus, Settings, Store, UserRound } from "lucide-react";
import { useSettings } from "@/components/settings/SettingsProvider";
import { Avatar } from "@/components/ui/Avatar";
import { useDiscardConfirm } from "@/components/workspace/unsaved-work";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { cn } from "@/lib/cn";
import { hardNavigate } from "@/lib/hard-navigate";
import { ROLE_LABEL } from "@/lib/workspace-types";
import { signOutAction, switchOrganizationAction } from "@/server/actions/workspace";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationsMenu } from "./NotificationsMenu";
import { usePopover } from "./usePopover";

const panelClasses = "absolute top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 shadow-overlay";
const itemClasses =
  "flex w-full items-center gap-2.5 rounded-btn px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-low disabled:opacity-60";

/** The business switcher: every workspace this person belongs to, with the active one marked. Switching reloads the page. */
function WorkspaceSwitcher() {
  const { business } = useSettings().settings;
  const { organization, organizations } = useWorkspace();
  const { open, setOpen, root, button, panelId } = usePopover();
  const [pending, setPending] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const discard = useDiscardConfirm("switch to another business");

  function choose(id: string) {
    if (pending) return;
    if (id === organization.id) {
      setOpen(false);
      return;
    }
    // A screen with unsaved edits asks first: nothing is lost, and nothing of this business is left in front of the next one.
    discard.run(() => void switchTo(id));
  }

  async function switchTo(id: string) {
    setPending(id);
    setProblem(undefined);
    let result: Awaited<ReturnType<typeof switchOrganizationAction>>;
    try {
      result = await switchOrganizationAction(id);
    } catch {
      result = { ok: false, error: "We couldn't reach the server, so nothing was changed. Check your connection and try again." };
    }
    if (!result.ok) {
      setProblem(result.error);
      setPending(undefined);
      return;
    }
    // A fresh page load, so nothing from the previous workspace (settings, drafts, cached pages) is left on screen.
    hardNavigate("/");
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Switch workspace"
        onClick={() => setOpen((current) => !current)}
        className="flex min-w-0 max-w-72 items-center gap-2.5 rounded-btn border border-line px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
      >
        <Store aria-hidden className="size-[18px] shrink-0 text-primary" />
        <span className="truncate">{business.name}</span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="Workspaces" className={cn(panelClasses, "left-0")}>
          <p className="px-3 pt-1 pb-1 text-micro font-bold tracking-wider text-ink-muted uppercase">Your workspaces</p>
          <ul>
            {organizations.map((item) => {
              const current = item.id === organization.id;
              return (
                <li key={item.id}>
                  <button type="button" disabled={Boolean(pending)} aria-current={current ? "true" : undefined} onClick={() => choose(item.id)} className={itemClasses}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{current ? business.name : item.name}</span>
                      <span className="block text-mini font-normal text-ink-muted">{ROLE_LABEL[item.role]}</span>
                    </span>
                    {current && <Check aria-label="Current workspace" className="size-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {problem && (
            <p role="alert" className="px-3 py-2 text-sm text-danger">
              {problem}
            </p>
          )}
          <div className="mt-1 border-t border-line pt-1">
            <Link href="/settings" onClick={() => setOpen(false)} className={itemClasses}>
              <Settings aria-hidden className="size-4 text-ink-muted" />
              Business settings
            </Link>
            <Link href="/onboarding?new=1" className={itemClasses}>
              <Plus aria-hidden className="size-4 text-ink-muted" />
              Create a workspace
            </Link>
          </div>
        </div>
      )}
      {discard.modal}
    </div>
  );
}

/** The signed-in person: their name, sign-in email and role in this workspace, their profile, and Log out. */
function UserMenu() {
  const { profile } = useSettings().settings;
  const { user, organization } = useWorkspace();
  const { open, setOpen, root, button, panelId } = usePopover();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const discard = useDiscardConfirm("log out");

  function logOut() {
    if (!pending) discard.run(() => void signOut());
  }

  async function signOut() {
    if (pending) return;
    setPending(true);
    setProblem(undefined);
    try {
      await signOutAction();
    } catch {
      // Not reaching the server means the session is still open: say so rather than pretending to be logged out.
      setProblem("We couldn't reach the server, so you are still logged in. Check your connection and try again.");
      setPending(false);
      return;
    }
    // A full page load, so no signed-in state survives in memory.
    hardNavigate("/login");
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`${profile.name}, ${profile.role}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-btn"
      >
        <Avatar name={profile.name} src={profile.photo} />
        <span className="hidden text-left whitespace-nowrap lg:block">
          <span className="block text-sm leading-tight font-semibold text-ink">{profile.name}</span>
          <span className="block text-mini leading-tight text-ink-muted">{profile.role}</span>
        </span>
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="Account" className={cn(panelClasses, "right-0")}>
          <div className="px-3 pt-2 pb-3">
            <p className="truncate text-sm font-semibold text-ink">{profile.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-1 truncate text-xs text-ink-muted">
              {ROLE_LABEL[organization.role]} · {organization.name}
            </p>
          </div>
          <div className="border-t border-line pt-1">
            <Link href="/settings/profile" onClick={() => setOpen(false)} className={itemClasses}>
              <UserRound aria-hidden className="size-4 text-ink-muted" />
              My profile
            </Link>
            <button type="button" disabled={pending} onClick={logOut} className={itemClasses}>
              <LogOut aria-hidden className="size-4 text-ink-muted" />
              {pending ? "Logging out…" : "Log out"}
            </button>
            {problem && (
              <p role="alert" className="px-3 py-2 text-sm text-danger">
                {problem}
              </p>
            )}
          </div>
        </div>
      )}
      {discard.modal}
    </div>
  );
}

export function TopBar() {
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

        <WorkspaceSwitcher />
      </div>

      <GlobalSearch />

      <div className="flex shrink-0 items-center gap-3 lg:gap-4">
        <NotificationsMenu />

        <div aria-hidden className="h-6 w-px bg-line" />

        <UserMenu />
      </div>
    </header>
  );
}
