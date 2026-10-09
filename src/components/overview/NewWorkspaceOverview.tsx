import { Rocket } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { BusinessInfoCard } from "./BusinessInfoCard";

/**
 * The Overview for a workspace that is not the sample business. It has a business record (name, contact, hours, time
 * zone) and nothing else yet: no customers, bookings, jobs or payments exist for it, so no totals are shown and none
 * are invented.
 */
export function NewWorkspaceOverview({ business }: { business: string }) {
  return (
    <>
      <PageHeader title="Workspace Overview" description={`Your workspace for ${business}.`} />
      <EmptyState
        icon={Rocket}
        title="Your workspace is ready"
        description="Your business information, hours and preferences are saved. Bookings, jobs, customers and payments will appear here as those areas become available for your workspace."
        action={<ButtonLink href="/settings">Review settings</ButtonLink>}
      />
      <BusinessInfoCard />
    </>
  );
}
