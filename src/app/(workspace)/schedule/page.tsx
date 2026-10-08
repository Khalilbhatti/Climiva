import type { Metadata } from "next";
import { Suspense } from "react";
import { ScheduleView } from "@/components/schedule/ScheduleView";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  // ScheduleView keeps its view, date and selected event in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ScheduleView />
    </Suspense>
  );
}
