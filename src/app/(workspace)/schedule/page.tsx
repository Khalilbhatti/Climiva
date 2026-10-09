import type { Metadata } from "next";
import { Suspense } from "react";
import { ScheduleView } from "@/components/schedule/ScheduleView";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  await requireWorkspaceContext();
  // ScheduleView keeps its view, date and selected event in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ScheduleView />
    </Suspense>
  );
}
