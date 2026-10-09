"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceSnapshot } from "@/lib/workspace-types";

const WorkspaceContext = createContext<WorkspaceSnapshot | null>(null);

/**
 * Who is signed in and which of their workspaces is active, as the server verified it for this page load. Read-only on
 * the client: a change of workspace or of person is always a fresh page load, so nothing here ever goes stale.
 */
export function WorkspaceProvider({ snapshot, children }: { snapshot: WorkspaceSnapshot; children: ReactNode }) {
  return <WorkspaceContext value={snapshot}>{children}</WorkspaceContext>;
}

export function useWorkspace(): WorkspaceSnapshot {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  return context;
}
