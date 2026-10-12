"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * When the workspace cannot be loaded (the database is unreachable, say) this is what appears: a plain explanation and a
 * retry. It never falls back to showing anyone's sample data in place of the real thing.
 */
export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <EmptyState
        as="h1"
        icon={TriangleAlert}
        title="We couldn't load your workspace"
        description="Something went wrong on our side, and nothing was changed. Try again in a moment."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
