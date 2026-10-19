"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { hardNavigate } from "@/lib/hard-navigate";
import { signOutAction } from "@/server/actions/workspace";

/** Ends the session, then loads the console's sign-in page afresh so nothing of the account stays in the page. */
export function PlatformSignOut() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOutAction();
        hardNavigate("/platform-admin/login");
      }}
    >
      <LogOut aria-hidden className="size-3.5" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
