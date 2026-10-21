"use client";

import { Plus } from "lucide-react";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCan } from "@/components/workspace/WorkspaceProvider";

/**
 * The Overview's heading. The supporting line names the business, so it follows the saved Business information. Creating a booking is for the people who
 * manage operations, so a team member who can only look does not get the button (the Bookings page would refuse them anyway).
 */
export function OverviewHeader() {
  const business = useBusiness();
  const canCreate = useCan("operations:manage");
  return (
    <PageHeader
      title="Overview"
      description={`What needs your attention today at ${business.name}.`}
      actions={
        canCreate ? (
          <ButtonLink href="/bookings?new=1" size="lg">
            <Plus aria-hidden className="size-[18px]" />
            Create booking
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
