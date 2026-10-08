"use client";

import { Plus } from "lucide-react";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

/** The Overview's heading. The supporting line names the business, so it follows the saved Business information. */
export function OverviewHeader() {
  const business = useBusiness();
  return (
    <PageHeader
      title="Workspace Overview"
      description={`Operational activity, scheduled appointments, and pending records for ${business.name}.`}
      actions={
        <ButtonLink href="/bookings?new=1" size="lg">
          <Plus aria-hidden className="size-[18px]" />
          New booking
        </ButtonLink>
      }
    />
  );
}
