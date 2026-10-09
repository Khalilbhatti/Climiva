"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button, ButtonLink } from "@/components/ui/Button";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { invoiceHref, paymentHref } from "@/config/routes";
import {
  PAYMENT_METHOD_LABEL,
  VOID_REASONS,
  getInvoiceAfterVoid,
  getInvoiceBalance,
  getInvoiceById,
  getInvoicePaid,
  getInvoiceStatus,
  getPaymentById,
  type Invoice,
  type Payment,
} from "@/data/financials";
import { getPartyName } from "@/data/operations";
import { useFinancials } from "./FinancialProvider";
import { InvoiceStatusBadge } from "./StatusBadges";
import { usd } from "./shared";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/**
 * Void a recorded payment. It stays in the invoice's history as Voided and stops counting toward the balance;
 * related quote, job and booking are not changed. This is separate from Record payment: it never creates a payment. The server
 * stores the void (once: a voided payment is final) and answers with the invoice reopened.
 */
export function VoidPaymentModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const dir = useDirectory();
  const { data, voidPayment } = useFinancials();
  const invoice = getInvoiceById(payment.invoiceId, data) as Invoice;

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showError, setShowError] = useState(false);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [done]);

  const live = getPaymentById(payment.id, data) ?? payment;

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Payment voided"
        description={`Payment #${payment.id} no longer contributes to Invoice #${invoice.id}.`}
        footer={
          <>
            <Button variant="tertiary" onClick={onClose} className="mr-auto">
              Close
            </Button>
            <ButtonLink variant="secondary" href={paymentHref(payment.id)} onClick={onClose}>
              View payment
            </ButtonLink>
            <ButtonLink href={invoiceHref(invoice.id)} onClick={onClose}>
              View invoice
            </ButtonLink>
          </>
        }
      >
        <div role="status" className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-positive focus:outline-none">
            <CircleCheck aria-hidden className="size-5" />
            Payment #{payment.id} voided
          </h3>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Payment", value: `#${payment.id}` },
              { label: "Status", value: live.status === "voided" ? "Voided" : "Recorded" },
              { label: "Original amount", value: `${usd(payment.amount)} (${PAYMENT_METHOD_LABEL[payment.method]})` },
              { label: "Invoice", value: `#${invoice.id}` },
              { label: "Payments received", value: usd(getInvoicePaid(invoice, data)) },
              { label: "Invoice balance due", value: usd(getInvoiceBalance(invoice, data)) },
              { label: "Invoice payment status", value: <InvoiceStatusBadge status={getInvoiceStatus(invoice, data)} /> },
            ]}
          />
          <p className="text-xs text-ink-muted">
            The payment record is kept in the invoice&rsquo;s history as Voided. Invoice #{invoice.id} has been reopened for payment.
          </p>
        </div>
      </Modal>
    );
  }

  const { paid: paidAfter, balance: balanceAfter } = getInvoiceAfterVoid(invoice, payment, data);

  async function confirm() {
    if (saving) return;
    if (!reason) return setShowError(true);
    setSaving(true);
    setProblem(undefined);
    const result = await voidPayment(payment.id, reason, note);
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setDone(true);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Void Payment #${payment.id}?`}
      description={`This removes the payment from Invoice #${invoice.id} while keeping the Payment record for history.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive-solid" onClick={confirm} disabled={saving}>
            {saving ? "Voiding…" : "Void payment"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-surface-low p-4 text-sm">
          <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Payment record</p>
          <p className="mt-1 font-semibold text-ink">
            #{payment.id} · {usd(payment.amount)}
          </p>
          <p className="text-xs text-ink-muted">
            {getPartyName(invoice, dir)} · Method: {PAYMENT_METHOD_LABEL[payment.method]}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-ink">
            Status: Recorded <ArrowRight aria-hidden className="size-3.5" /> Voided
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface-low p-4 text-sm">
          <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Invoice impact · #{invoice.id}</p>
          <KeyValueList
            className="mt-1"
            items={[
              { label: "Paid total", value: `${usd(getInvoicePaid(invoice, data))} → ${usd(paidAfter)}` },
              { label: "Balance due", value: `${usd(getInvoiceBalance(invoice, data))} → ${usd(balanceAfter)}` },
              { label: "Payment status", value: `${balanceAfter === 0 ? "Paid" : paidAfter > 0 ? "Partially paid" : "Unpaid"}` },
            ]}
          />
        </div>
      </div>

      <Select
        label="Reason for voiding"
        required
        value={reason}
        error={showError && !reason ? "Select a reason for voiding this payment." : undefined}
        onChange={(event) => setReason(event.target.value)}
      >
        <option value="">Select a reason...</option>
        {VOID_REASONS.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </Select>
      <Textarea label="Internal note (optional)" rows={2} value={note} hint="Visible only to your team." onChange={(event) => setNote(event.target.value)} />
      <p className="text-xs text-ink-muted">
        Payment #{payment.id} will remain in the invoice&rsquo;s payment history with status Voided. The related quote, job and booking are not
        changed.
      </p>
      {problem && <FormAlert>{problem}</FormAlert>}
    </Modal>
  );
}
