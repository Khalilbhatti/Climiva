import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BusinessInfoCard } from "@/components/overview/BusinessInfoCard";
import { GettingStarted } from "@/components/overview/GettingStarted";
import { OverviewHeader } from "@/components/overview/OverviewHeader";
import { OverviewKpis } from "@/components/overview/OverviewKpis";
import { QuickActions } from "@/components/overview/QuickActions";
import { ActiveJobsCard, AttentionCard, ComingUpCard, TodayCard } from "@/components/overview/WorkSections";
import { Card } from "@/components/ui/Card";
import type { Directory } from "@/data/directory";
import { activeJobs, gettingStartedCookie, hasActivity, needsAttention, setupState, todaysAgenda, upcomingBookings } from "@/lib/overview-rules";
import { can } from "@/lib/policy";
import { getCoreSnapshot } from "@/server/core-data";
import { getMonthTotals } from "@/server/reporting";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Overview" };

/**
 * The control center: what is on today, what needs an answer, what is coming, what is under way, and (until the owner hides it) how far the setup has got.
 * Every figure and every row is worked out from the business's own records (lib/overview-rules), for any business: a new one with nothing yet is asked to
 * set up and shown no empty "today", and one with activity sees its day.
 */
export default async function OverviewPage() {
  const { snapshot, role, organizationId } = await requireWorkspaceContext();
  const core = await getCoreSnapshot();
  if (!core) throw new Error("The workspace was verified but its data could not be read.");

  const today = snapshot.clock.today;
  const dir: Directory = { ...core.book, services: core.services, team: core.team };
  const manages = can(role, "settings:manage");
  const setup = setupState(core);
  const showSetup = manages && (await cookies()).get(gettingStartedCookie(organizationId))?.value !== "1";
  const active = hasActivity(core);

  return (
    <>
      <OverviewHeader />

      {showSetup && <GettingStarted organizationId={organizationId} setup={setup} />}

      {active ? (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TodayCard items={todaysAgenda(core, today)} />
            <AttentionCard items={needsAttention(core, today)} />
            <ComingUpCard bookings={upcomingBookings(core, today)} dir={dir} />
            <ActiveJobsCard jobs={activeJobs(core)} dir={dir} />
          </div>
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-ink">This month</h2>
            <OverviewKpis month={await getMonthTotals()} />
          </div>
        </>
      ) : (
        !showSetup && (
          <Card padding="lg">
            <h2 className="text-base font-semibold text-ink">No bookings yet</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Bookings from your website and the Marketplace show up here as they arrive, with what is on today and what needs your answer.
              {manages ? " You can also create one yourself." : ""}
            </p>
          </Card>
        )
      )}

      <QuickActions />
      <BusinessInfoCard />
    </>
  );
}
