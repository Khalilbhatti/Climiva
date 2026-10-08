import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateRole } from "@/components/team/CreateRole";

export const metadata: Metadata = { title: "Create role" };

export default function CreateRolePage() {
  // CreateRole reads ?from= (the Duplicate action), which needs a Suspense boundary.
  return (
    <Suspense>
      <CreateRole />
    </Suspense>
  );
}
