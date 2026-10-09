import { Settings as SettingsIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * What a workspace sees in a module that has not been moved to the database yet.
 *
 * Those modules still show a built-in sample dataset, and that dataset belongs to ONE sample business. Any other
 * workspace gets this instead, so nothing is ever shown as if it belonged to the wrong business. Settings, Help and the
 * business details are real for every workspace.
 */
export function ModuleUnavailable({ name, business }: { name: string; business: string }) {
  return (
    <>
      <PageHeader title={name} />
      <EmptyState
        icon={SettingsIcon}
        title={`${name} isn't available for ${business} yet`}
        description="This area is still being prepared for your workspace. Your business information, hours and preferences are ready in Settings."
        action={<ButtonLink href="/settings">Open Settings</ButtonLink>}
      />
    </>
  );
}

/** The same message for the customer-facing pages, which have no workspace chrome. */
export function PublicUnavailable() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <h1 className="text-xl font-bold text-ink">This page isn&apos;t available</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">The page you were looking for is not published.</p>
    </main>
  );
}
