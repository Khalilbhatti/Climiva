"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Booking, Job, JobDetails, JobFile, OperationsData } from "@/data/operations";
import type { ActionResult } from "@/lib/action-result";
import type { NewBookingInput } from "@/lib/operations-rules";
import { send } from "@/lib/send-action";
import {
  assignAction,
  cancelBookingAction,
  completeJobAction,
  confirmBookingAction,
  createBookingAction,
  createJobAction,
  setFileVisibilityAction,
  startJobAction,
  updateJobDetailsAction,
} from "@/server/actions/operations";

/** What every change resolves with: the operations as stored, or why it was refused. */
type Done = Promise<ActionResult<{ operations: OperationsData }>>;

type OperationsContextValue = {
  /** The business's Bookings, Jobs and blocked time, as stored (plus any photos chosen in this browser, see addSessionFiles). */
  data: OperationsData;
  createBooking: (input: NewBookingInput) => Promise<ActionResult<{ operations: OperationsData; booking: Booking }>>;
  confirmBooking: (bookingId: string) => Done;
  /** Declines a pending request or cancels a confirmed booking. A reason is required. */
  cancelBooking: (bookingId: string, reason: string) => Done;
  /** Gives work to a team member, or takes it back (`undefined`). A booking and its job always change together. */
  assign: (target: { bookingId?: string; jobId?: string }, memberId: string | undefined) => Done;
  createJobForBooking: (bookingId: string) => Promise<ActionResult<{ operations: OperationsData; job: Job }>>;
  startJob: (jobId: string) => Done;
  updateJobDetails: (jobId: string, patch: Partial<JobDetails>) => Done;
  /** Completes the job, keeping any work details not yet saved, and completes its booking in the same step. */
  completeJob: (jobId: string, notes: string, details?: Partial<JobDetails>) => Done;
  /** Photos chosen in this browser. There is no file storage yet, so they live only until the page is reloaded. */
  addSessionFiles: (jobId: string, files: readonly JobFile[]) => void;
  setFileVisibility: (jobId: string, fileId: string, visibility: JobFile["visibility"]) => Done;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

/**
 * The business's Bookings, Jobs and Schedule blocks for the whole workspace. `initial` is what the server read from
 * PostgreSQL for this page load, for the ACTIVE organization only. Every change goes to the server, which authorizes it
 * (owner or admin), validates it, stores it in one transaction and answers with the operations as stored; only then does
 * the working copy change, so the screen is never ahead of the database. Mounted once in the workspace layout so Bookings,
 * Schedule, Jobs and the Customers pages always agree.
 *
 * The one thing that is not stored is the bytes of a photo: no file storage exists yet. Photos chosen in this browser are
 * kept here and marked `sessionOnly`, so they can be shown now and are never claimed to be saved.
 */
export function OperationsProvider({ initial, children }: { initial: OperationsData; children: ReactNode }) {
  const [stored, setStored] = useState<OperationsData>(initial);
  const [sessionFiles, setSessionFiles] = useState<Readonly<Record<string, readonly JobFile[]>>>({});

  /** Adopt the operations a successful change answered with. */
  const adopt = useCallback(<T extends { operations: OperationsData }>(result: ActionResult<T>): ActionResult<T> => {
    if (result.ok) setStored(result.data.operations);
    return result;
  }, []);

  const data = useMemo<OperationsData>(
    () => (Object.keys(sessionFiles).length === 0 ? stored : { ...stored, jobs: stored.jobs.map((job) => (sessionFiles[job.id] ? { ...job, files: [...job.files, ...sessionFiles[job.id]] } : job)) }),
    [stored, sessionFiles],
  );

  const value = useMemo<OperationsContextValue>(
    () => ({
      data,
      createBooking: async (input) => adopt(await send(() => createBookingAction(input))),
      confirmBooking: async (id) => adopt(await send(() => confirmBookingAction(id))),
      cancelBooking: async (id, reason) => adopt(await send(() => cancelBookingAction(id, reason))),
      assign: async (target, memberId) => adopt(await send(() => assignAction(target, memberId ?? null))),
      createJobForBooking: async (id) => adopt(await send(() => createJobAction(id))),
      startJob: async (id) => adopt(await send(() => startJobAction(id))),
      updateJobDetails: async (id, patch) => adopt(await send(() => updateJobDetailsAction(id, patch))),
      completeJob: async (id, notes, details) => adopt(await send(() => completeJobAction(id, notes, details))),
      addSessionFiles: (jobId, files) => setSessionFiles((current) => ({ ...current, [jobId]: [...(current[jobId] ?? []), ...files] })),
      setFileVisibility: async (jobId, fileId, visibility) => {
        // A photo chosen in this browser was never stored: only its label here changes.
        if (sessionFiles[jobId]?.some((file) => file.id === fileId)) {
          setSessionFiles((current) => ({ ...current, [jobId]: (current[jobId] ?? []).map((file) => (file.id === fileId ? { ...file, visibility } : file)) }));
          return { ok: true, data: { operations: stored } };
        }
        return adopt(await send(() => setFileVisibilityAction(jobId, fileId, visibility)));
      },
    }),
    [data, stored, sessionFiles, adopt],
  );

  return <OperationsContext value={value}>{children}</OperationsContext>;
}

export function useOperations(): OperationsContextValue {
  const context = useContext(OperationsContext);
  if (!context) throw new Error("useOperations must be used inside <OperationsProvider>.");
  return context;
}
