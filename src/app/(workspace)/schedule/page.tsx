import type { Metadata } from "next";
import { Suspense } from "react";
import { ScheduleView } from "@/components/schedule/ScheduleView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const gate = await fixtureGate("Schedule");
  if (gate) return gate;
  // ScheduleView keeps its view, date and selected event in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ScheduleView />
    </Suspense>
  );
}
