import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateRole } from "@/components/team/CreateRole";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Create role" };

export default async function CreateRolePage() {
  await requireWorkspaceContext();
  // CreateRole reads ?from= (the Duplicate action), which needs a Suspense boundary.
  return (
    <Suspense>
      <CreateRole />
    </Suspense>
  );
}
