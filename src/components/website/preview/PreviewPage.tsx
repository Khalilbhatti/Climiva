"use client";

import { useOperations } from "@/components/operations/OperationsProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useClock } from "@/components/workspace/WorkspaceProvider";
import { getShownServices, orderedPages } from "@/data/website";
import type { AppHref } from "@/config/routes";
import { pageHrefIn } from "../site-view";
import { BookingJourney, type JourneyResult, type JourneySubmission } from "../BookingJourney";
import { PREVIEW_BASE } from "../site-links";
import { SiteRenderer } from "../SiteRenderer";
import { useSiteView, useWebsiteState } from "../WebsiteProvider";
import { useServices } from "@/components/services/ServicesProvider";

/**
 * One page of the saved DRAFT, inside the signed-in preview, or one Service's booking journey under the Booking page. The same renderer
 * the published site uses, fed with the Draft. The booking made here is made as the signed-in owner or admin through the workspace's
 * authorized action (this is a preview inside the workspace); the published site uses the public booking path instead.
 */
export function PreviewPage({ segments }: { segments: string[] }) {
  const website = useWebsiteState();
  const view = useSiteView(website.draft, PREVIEW_BASE);
  const { createBooking } = useOperations();
  const { hours } = useSettings().settings;
  const { today } = useClock();
  const { services: catalog } = useServices();

  const page = orderedPages(website.draft).find((candidate) => candidate.visible && candidate.slug === (segments[0] ?? ""));
  if (!page) return null;

  if (page.type === "booking" && segments.length === 2) {
    const service = getShownServices(website.draft.settings.serviceDisplay, catalog).find((candidate) => candidate.id === segments[1]);
    const submit = async (s: JourneySubmission): Promise<JourneyResult> => {
      const extras = s.service.intake
        .filter((question) => question.type === "single-select" && !["primary-issue", "system-type"].includes(question.id) && s.answers[question.id])
        .map((question) => `${question.prompt} ${s.answers[question.id]}`);
      const note = [s.notes, ...extras].filter(Boolean).join(" · ");
      const result = await createBooking({
        contactName: s.name,
        contact: { phone: s.phone, email: s.email, address: s.address },
        serviceId: s.service.id,
        source: "Website",
        date: s.date,
        start: s.start,
        end: s.end,
        intake: { reportedIssue: s.answers["primary-issue"], systemType: s.answers["system-type"] },
        note: note || undefined,
      });
      return result.ok ? { ok: true, reference: result.data.booking.id } : { ok: false, error: result.error };
    };
    return (
      <BookingJourney
        service={service}
        view={view}
        hours={hours}
        today={today}
        submit={submit}
        bookingHref={pageHrefIn(view, page.key)}
        homeHref={view.base as AppHref}
      />
    );
  }
  if (segments.length > 1) return null;
  return <SiteRenderer page={page} view={view} />;
}
