"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { OPERATIONS, type Booking, type Job, type JobDetails, type JobFile, type OperationsData } from "@/data/operations";
import * as state from "@/lib/operations-state";

type OperationsContextValue = {
  /** The working data: canonical fixtures plus any demo changes made in this session. */
  data: OperationsData;
  createBooking: (input: state.NewBookingInput) => Booking;
  confirmBooking: (bookingId: string) => void;
  cancelBooking: (bookingId: string, reason: string) => void;
  assign: (target: { bookingId?: string; jobId?: string }, memberId: string | undefined) => void;
  createJobForBooking: (bookingId: string) => Job | undefined;
  startJob: (jobId: string) => void;
  updateJobDetails: (jobId: string, patch: Partial<JobDetails>) => void;
  completeJob: (jobId: string, notes: string) => void;
  addJobFiles: (jobId: string, files: readonly JobFile[]) => void;
  setFileVisibility: (jobId: string, fileId: string, visibility: JobFile["visibility"]) => void;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

/**
 * Holds the demo copy of Bookings, Jobs and Schedule blocks for the whole workspace. It starts as the
 * canonical fixtures, lives only in memory (a reload restores them) and never writes back to
 * data/operations.ts. Mounted once in the workspace layout so Bookings, Schedule, Jobs and the
 * Customers pages always agree on what has happened this session.
 */
export function OperationsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OperationsData>(OPERATIONS);
  // The ref lets actions that return a value (createBooking) read the latest data synchronously.
  const latest = useRef(data);

  const commit = useCallback((next: OperationsData) => {
    latest.current = next;
    setData(next);
  }, []);

  const value = useMemo<OperationsContextValue>(
    () => ({
      data,
      createBooking: (input) => {
        const result = state.createBooking(latest.current, input);
        commit(result.data);
        return result.booking;
      },
      confirmBooking: (id) => commit(state.confirmBooking(latest.current, id)),
      cancelBooking: (id, reason) => commit(state.cancelBooking(latest.current, id, reason)),
      assign: (target, memberId) => commit(state.assign(latest.current, target, memberId)),
      createJobForBooking: (id) => {
        const result = state.createJobForBooking(latest.current, id);
        commit(result.data);
        return result.job;
      },
      startJob: (id) => commit(state.startJob(latest.current, id)),
      updateJobDetails: (id, patch) => commit(state.updateJobDetails(latest.current, id, patch)),
      completeJob: (id, notes) => commit(state.completeJob(latest.current, id, notes)),
      addJobFiles: (id, files) => commit(state.addJobFiles(latest.current, id, files)),
      setFileVisibility: (id, fileId, visibility) => commit(state.setFileVisibility(latest.current, id, fileId, visibility)),
    }),
    [data, commit],
  );

  return <OperationsContext value={value}>{children}</OperationsContext>;
}

export function useOperations(): OperationsContextValue {
  const context = useContext(OperationsContext);
  if (!context) throw new Error("useOperations must be used inside <OperationsProvider>.");
  return context;
}
