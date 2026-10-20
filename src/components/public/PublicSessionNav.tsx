"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { hardNavigate } from "@/lib/hard-navigate";
import { cn } from "@/lib/cn";

/** `on-dark`: white text on the teal band; `on-light`: ink text on the page. */
export type NavTone = "on-dark" | "on-light";

type State = { signedIn: boolean; workspace: boolean; platformAdmin: boolean };
type Phase = "loading" | "anonymous" | "member" | "no-workspace";

const TEXT_LINK: Record<NavTone, string> = {
  "on-dark": "rounded-btn px-2 py-1.5 text-sm font-semibold text-white/90 hover:text-white hover:underline focus-visible:outline-white",
  "on-light": "rounded-btn px-2 py-1.5 text-sm font-semibold text-ink-muted hover:text-primary hover:underline",
};
const BUTTON: Record<NavTone, string> = {
  "on-dark": "inline-flex items-center justify-center rounded-btn bg-white px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-subtle focus-visible:outline-white",
  "on-light": "inline-flex items-center justify-center rounded-btn bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover",
};

/**
 * The account links in the header of Climvia's public pages: Sign in and List your business for a visitor, a way back to the dashboard for a business
 * member, and (for a platform administrator only) a quiet link to the console.
 *
 * The public pages carry no session, so this is the one place they learn who is looking: AFTER the page has loaded it asks `/api/session-state`, which
 * answers three booleans about the caller. Until it answers (and if it never does) the signed-out links are shown, which is also exactly what the server
 * rendered, so the page's HTML is the same for everyone. Nothing about the person is kept in the page.
 */
export function PublicSessionNav({ tone = "on-light" }: { tone?: NavTone }) {
  const [state, setState] = useState<State | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let current = true;
    fetch("/api/session-state", { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<State>) : null))
      .then((answer) => {
        if (current && answer && typeof answer.signedIn === "boolean") setState(answer);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  const phase: Phase = state === null ? "loading" : !state.signedIn ? "anonymous" : state.workspace ? "member" : "no-workspace";

  async function signOut() {
    if (leaving) return;
    setLeaving(true);
    try {
      await authClient.signOut();
    } catch {
      // Already signed out, or the session is gone: either way the next page is the signed-out one.
    }
    // A full load, so nothing of the account stays in the page.
    hardNavigate("/");
  }

  return (
    <nav aria-label="Account" data-session={phase} className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {state?.platformAdmin && phase === "member" && (
        <Link prefetch={false} href="/platform-admin" className={TEXT_LINK[tone]}>
          Platform console
        </Link>
      )}
      {phase === "member" || phase === "no-workspace" ? (
        <>
          <button type="button" onClick={signOut} disabled={leaving} className={cn(TEXT_LINK[tone], "disabled:opacity-60")}>
            {leaving ? "Signing out…" : "Sign out"}
          </button>
          {phase === "member" ? (
            <Link prefetch={false} href="/overview" className={BUTTON[tone]}>
              Go to Dashboard
            </Link>
          ) : state?.platformAdmin ? (
            // An administrator with no business of their own is not asked to make one: the console is their way in.
            <Link prefetch={false} href="/platform-admin" className={BUTTON[tone]}>
              Platform console
            </Link>
          ) : (
            <Link prefetch={false} href="/onboarding" className={BUTTON[tone]}>
              Finish setting up
            </Link>
          )}
        </>
      ) : (
        <>
          <Link prefetch={false} href="/login" className={TEXT_LINK[tone]}>
            Sign in
          </Link>
          <Link prefetch={false} href="/signup" className={BUTTON[tone]}>
            List your business
          </Link>
        </>
      )}
    </nav>
  );
}
