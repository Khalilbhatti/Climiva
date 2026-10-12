"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { PAGE_STATUS_LABEL, type PageStatus } from "@/data/website";
import { useWebsite } from "./WebsiteProvider";

const PAGE_TONE: Record<PageStatus, StatusTone> = {
  published: "positive",
  "unpublished-changes": "warning",
  private: "neutral",
};

export function PageStatusBadge({ status }: { status: PageStatus }) {
  return <StatusBadge tone={PAGE_TONE[status]}>{PAGE_STATUS_LABEL[status]}</StatusBadge>;
}

export function SiteStatusBadge({ published }: { published: boolean }) {
  return <StatusBadge tone={published ? "positive" : "neutral"}>{published ? "Published" : "Private"}</StatusBadge>;
}

/** Publish and unpublish with their confirmations. Neither touches Bookings, Services, Customers, Jobs, Invoices or Payments. */
export function usePublishing() {
  const { website, publish, unpublish } = useWebsite();
  const { toast } = useToast();
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [busy, setBusy] = useState(false);

  return {
    busy,
    async publishNow() {
      if (busy) return;
      setBusy(true);
      const result = await publish();
      setBusy(false);
      toast(result.ok ? "Website published." : result.error);
    },
    askUnpublish: () => setConfirmingUnpublish(true),
    unpublishModal: (
      <Modal
        open={confirmingUnpublish}
        onClose={() => setConfirmingUnpublish(false)}
        title="Unpublish website?"
        description="Your website will become private. Pages and content are kept, and nothing else in Climvia changes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingUnpublish(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              onClick={async () => {
                const result = await unpublish();
                setConfirmingUnpublish(false);
                toast(result.ok ? "Website unpublished. It is now private." : result.error);
              }}
            >
              Unpublish
            </Button>
          </>
        }
      >
        <p className="rounded-card bg-surface-low p-3 text-sm text-ink-muted">
          Customers can no longer open the live website
          {website?.domain.custom ? " on either address" : ""}. Bookings, Services, Customers, Jobs, Invoices and Payments are not changed.
        </p>
      </Modal>
    ),
  };
}

/** A browser-window frame around a rendered page (editor canvas, Overview preview). */
export function BrowserFrame({
  address,
  note,
  children,
  className,
}: {
  address: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-line bg-surface shadow-card", className)}>
      <div className="flex items-center gap-3 border-b border-line bg-surface-low px-3 py-2">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-btn bg-surface px-2.5 py-1 text-xs text-ink-muted">
          <Lock aria-hidden className="size-3 shrink-0" />
          <span className="truncate font-mono">{address}</span>
        </span>
        {note && <span className="hidden text-xs font-medium text-ink-muted sm:inline">{note}</span>}
      </div>
      {children}
    </div>
  );
}
