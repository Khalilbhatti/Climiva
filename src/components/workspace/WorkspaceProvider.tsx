"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BusinessClock } from "@/lib/business-time";
import type { Capability } from "@/lib/policy";
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

/** Whether the signed-in person may do this in the active workspace. A convenience for the screen; the server still decides. */
export function useCan(capability: Capability): boolean {
  return useWorkspace().capabilities.includes(capability);
}

/**
 * Today and now in the active business's time zone ("2024-10-25", "2024-10-25T10:45"), computed on the server for this page
 * load. Every "today" on a screen comes from here, never from the browser's clock, so every browser time zone agrees.
 */
export function useClock(): BusinessClock {
  return useWorkspace().clock;
}
