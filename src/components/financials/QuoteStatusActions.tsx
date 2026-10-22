"use client";

import { useState } from "react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { Quote, QuoteStatus } from "@/data/financials";
import { QUOTE_TRANSITIONS } from "@/lib/financial-rules";
import { useFinancials } from "./FinancialProvider";

/** What each step says on its button, what it asks before it is taken, and what the toast says afterwards. */
const STEP: Record<Exclude<QuoteStatus, "draft">, { button: string; title: (id: string) => string; text: string; done: (id: string) => string; confirmLabel: string; sensitive: boolean }> = {
  sent: {
    button: "Mark as sent",
    title: (id) => `Mark Quote #${id} as sent?`,
    text: "Climvia does not send quotes for you. Mark it sent once you have given it to your customer.",
    done: (id) => `Quote #${id} is marked sent.`,
    confirmLabel: "Mark as sent",
    sensitive: false,
  },
  approved: {
    button: "Customer approved",
    title: (id) => `Mark Quote #${id} as approved?`,
    text: "Use this when your customer has said yes. It can't be undone, and an approved quote can then be invoiced. Approving does not create an invoice by itself.",
    done: (id) => `Quote #${id} is approved. You can create its invoice now.`,
    confirmLabel: "Mark as approved",
    sensitive: true,
  },
  declined: {
    button: "Customer declined",
    title: (id) => `Mark Quote #${id} as declined?`,
    text: "Use this when your customer has said no. It can't be undone, and a declined quote can't be invoiced.",
    done: (id) => `Quote #${id} is marked declined.`,
    confirmLabel: "Mark as declined",
    sensitive: true,
  },
  expired: {
    button: "Mark expired",
    title: (id) => `Mark Quote #${id} as expired?`,
    text: "Use this when the price is no longer good. It can't be undone, and an expired quote can't be invoiced.",
    done: (id) => `Quote #${id} is marked expired.`,
    confirmLabel: "Mark as expired",
    sensitive: true,
  },
};

/**
 * The steps a quote can take from where it is: draft, then sent, then approved, declined or expired (the last three are final). Only an owner or admin is
 * offered them (the server asks again). Each step that cannot be taken back asks first, in words that say what it does and does not do.
 */
export function QuoteStatusActions({ quote }: { quote: Quote }) {
  const { updateQuoteStatus } = useFinancials();
  const { toast } = useToast();
  const [asking, setAsking] = useState<Exclude<QuoteStatus, "draft"> | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();

  const steps = QUOTE_TRANSITIONS[quote.status].filter((status): status is Exclude<QuoteStatus, "draft"> => status !== "draft");
  if (steps.length === 0) return null;

  async function take(status: Exclude<QuoteStatus, "draft">) {
    setSaving(true);
    setProblem(undefined);
    const result = await updateQuoteStatus(quote.id, status);
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setAsking(null);
    toast(STEP[status].done(quote.id));
  }

  function begin(status: Exclude<QuoteStatus, "draft">) {
    setProblem(undefined);
    if (STEP[status].sensitive) setAsking(status);
    else void take(status);
  }

  return (
    <div className="mt-3 space-y-2">
      {quote.status === "draft" && <p className="text-xs text-ink-muted">This quote is a draft. Climvia does not send it: give it to your customer, then mark it sent.</p>}
      {quote.status === "sent" && <p className="text-xs text-ink-muted">Record what your customer decided.</p>}
      <div className="flex flex-col gap-2">
        {steps.map((status, index) => (
          <Button key={status} variant={index === 0 ? "primary" : "secondary"} className="w-full" disabled={saving} onClick={() => begin(status)}>
            {STEP[status].button}
          </Button>
        ))}
      </div>
      {problem && asking === null && <FormAlert>{problem}</FormAlert>}
      {asking && (
        <Modal
          open
          onClose={() => !saving && setAsking(null)}
          title={STEP[asking].title(quote.id)}
          description={STEP[asking].text}
          footer={
            <ModalActions onCancel={() => setAsking(null)}>
              <Button onClick={() => take(asking)} disabled={saving}>
                {saving ? "Saving…" : STEP[asking].confirmLabel}
              </Button>
            </ModalActions>
          }
        >
          {problem && <FormAlert>{problem}</FormAlert>}
        </Modal>
      )}
    </div>
  );
}
