"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Textarea } from "@/components/ui/Textarea";
import { invoiceHref, paymentHref } from "@/config/routes";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  getBalanceAfter,
  getInvoiceBalance,
  getInvoiceById,
  getInvoicePaid,
  getInvoiceStatus,
  getInvoiceTotal,
  getOutstandingInvoices,
  getRelatedWork,
  type Invoice,
  type Payment,
  type PaymentMethod,
} from "@/data/financials";
import { getPartyName } from "@/data/operations";
import { formatDate } from "@/lib/format";
import { amountToCents, fromCents, toCents } from "@/lib/money";
import { useFinancials } from "./FinancialProvider";
import { InvoiceStatusBadge } from "./StatusBadges";
import { usd } from "./shared";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useClock } from "@/components/workspace/WorkspaceProvider";

type RecordPaymentModalProps = {
  /** Skip the invoice step when the flow starts from one invoice. */
  initialInvoiceId?: string;
  onClose: () => void;
};

/**
 * The one Record payment flow: Payments, the Outstanding invoices tab, an invoice page and the Overview quick
 * action all open it. Step 1 picks an invoice that still has a balance (a fully paid invoice never appears),
 * step 2 takes the amount, method and date, and the confirmation names the new payment. Nothing is sent to a
 * payment service: the payment is a record of money the business received, stored by the server, which checks the amount against
 * the invoice's balance again.
 */
export function RecordPaymentModal({ initialInvoiceId, onClose }: RecordPaymentModalProps) {
  const dir = useDirectory();
  const { data, recordPayment } = useFinancials();
  const { today } = useClock();
  const [stage, setStage] = useState<"select" | "details" | "done">(initialInvoiceId ? "details" : "select");
  const [invoiceId, setInvoiceId] = useState<string | undefined>(initialInvoiceId);
  const [selectError, setSelectError] = useState(false);
  const [recorded, setRecorded] = useState<Payment | null>(null);

  const [partial, setPartial] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [checkNumber, setCheckNumber] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
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
  }, [stage]);

  const outstanding = getOutstandingInvoices(data);
  const invoice = invoiceId ? getInvoiceById(invoiceId, data) : undefined;
  // An invoice from outside the flow that has no balance can't take a payment.
  const payable = invoice && getInvoiceBalance(invoice, data) > 0 ? invoice : undefined;

  const balance = payable ? getInvoiceBalance(payable, data) : 0;
  // What was typed is read as exact cents, never as a float.
  const typedCents = partial ? amountToCents(partialAmount) : undefined;
  const amount = partial ? (typedCents === undefined ? 0 : fromCents(typedCents)) : balance;
  const amountError =
    partial && (!partialAmount.trim() || typedCents === undefined || !(typedCents > 0) || typedCents > toCents(balance))
      ? `Enter an amount between ${usd(0.01)} and ${usd(balance)}.`
      : undefined;
  const dateError = !date ? "Enter the date the payment was received." : date > today ? "The payment date can't be in the future." : undefined;
  const afterBalance = payable ? getBalanceAfter(payable, data, amountError ? 0 : amount) : 0;

  function choose(id: string) {
    setInvoiceId(id);
    setSelectError(false);
    setPartial(false);
    setPartialAmount("");
  }

  async function submit() {
    if (saving) return;
    if (!payable || amountError || dateError) return setShowErrors(true);
    setSaving(true);
    setProblem(undefined);
    const result = await recordPayment({ invoiceId: payable.id, amount, method, date, checkNumber, note });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setRecorded(result.data.payment);
    setStage("done");
  }

  /* ───────── 1. choose the invoice ───────── */
  if (stage === "select") {
    return (
      <Modal
        open
        onClose={onClose}
        size="lg"
        title="Record payment"
        description="Choose the Invoice this payment should be recorded against."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!invoiceId) return setSelectError(true);
                setStage("details");
              }}
            >
              Continue
            </Button>
          </>
        }
      >
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
          Select an invoice
        </h3>
        {outstanding.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No invoices have an outstanding balance.</p>
        ) : (
          <div>
            <OptionGroup legend="Outstanding invoices" hint="Select an invoice with an outstanding balance. You can record a full or partial payment next.">
              {outstanding.map((item) => (
                <OptionCard
                  key={item.id}
                  type="radio"
                  name="record-payment-invoice"
                  title={`#${item.id} · ${getPartyName(item, dir)}`}
                  badge={<InvoiceStatusBadge status={getInvoiceStatus(item, data)} />}
                  description={
                    <>
                      Invoice total: {usd(getInvoiceTotal(item))} · Payments received: {usd(getInvoicePaid(item, data))}
                      <span className="block font-semibold text-ink">Balance due: {usd(getInvoiceBalance(item, data))}</span>
                    </>
                  }
                  checked={invoiceId === item.id}
                  onChange={() => choose(item.id)}
                />
              ))}
            </OptionGroup>
            {selectError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                Select an invoice to continue.
              </p>
            )}
          </div>
        )}
        {invoice && payable && (
          <p role="status" className="rounded-btn bg-primary-subtle px-3 py-2 text-sm text-ink">
            Selected: Invoice #{payable.id} ({getPartyName(payable, dir)}) · Balance due: {usd(balance)}
          </p>
        )}
      </Modal>
    );
  }

  /* ───────── 3. recorded ───────── */
  if (stage === "done" && recorded) {
    const done = getInvoiceById(recorded.invoiceId, data) as Invoice;
    return (
      <Modal
        open
        onClose={onClose}
        title="Payment recorded"
        description={`Payment #${recorded.id} was recorded against Invoice #${recorded.invoiceId}.`}
        footer={
          <>
            <Button variant="tertiary" onClick={onClose} className="mr-auto">
              Close
            </Button>
            <ButtonLink variant="secondary" href={invoiceHref(recorded.invoiceId)} onClick={onClose}>
              View invoice
            </ButtonLink>
            <ButtonLink href={paymentHref(recorded.id)} onClick={onClose}>
              View payment
            </ButtonLink>
          </>
        }
      >
        <div role="status" className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-positive focus:outline-none">
            <CircleCheck aria-hidden className="size-5" />
            Payment #{recorded.id} recorded
          </h3>
          <KeyValueList
            className="rounded-card border border-line bg-surface-low p-4"
            items={[
              { label: "Customer", value: getPartyName(done, dir) },
              { label: "Invoice", value: `#${done.id}` },
              { label: "Amount", value: usd(recorded.amount) },
              { label: "Method", value: PAYMENT_METHOD_LABEL[recorded.method] },
              { label: "Payment date", value: formatDate(recorded.date) },
              { label: "Remaining balance", value: usd(getInvoiceBalance(done, data)) },
              { label: "Invoice status", value: <InvoiceStatusBadge status={getInvoiceStatus(done, data)} /> },
            ]}
          />
        </div>
      </Modal>
    );
  }

  /* ───────── 2. amount, method, date ───────── */
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Record payment"
      description={payable ? `${getPartyName(payable, dir)} · Balance due ${usd(balance)}` : "Choose an invoice with an outstanding balance."}
      footer={
        <>
          {!initialInvoiceId && (
            <Button variant="tertiary" className="mr-auto" onClick={() => setStage("select")}>
              Back
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!payable || saving}>
            {saving ? "Recording…" : "Record payment"}
          </Button>
        </>
      }
    >
      <h3 ref={headingRef} tabIndex={-1} className="sr-only">
        Payment details for Invoice {invoiceId}
      </h3>
      {!payable ? (
        <p role="alert" className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
          Invoice #{invoiceId} has no balance due, so no payment can be recorded against it.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
          <div className="space-y-5">
            <OptionGroup legend="Payment amount">
              <OptionCard
                type="radio"
                name="payment-amount"
                title={`Full payment · ${usd(balance)}`}
                description="Marks this invoice as paid."
                checked={!partial}
                onChange={() => setPartial(false)}
              />
              <OptionCard
                type="radio"
                name="payment-amount"
                title="Partial payment"
                description="Record part of the outstanding balance."
                checked={partial}
                onChange={() => setPartial(true)}
              />
            </OptionGroup>
            {partial && (
              <Input
                label="Partial amount (USD)"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                value={partialAmount}
                error={showErrors ? amountError : undefined}
                onChange={(event) => setPartialAmount(event.target.value)}
              />
            )}
            <p className="text-sm text-ink-muted">
              Balance after this payment: <strong className="text-ink">{usd(afterBalance)}</strong>
            </p>

            <OptionGroup legend="Payment method" className="grid-cols-2 sm:grid-cols-3">
              {PAYMENT_METHODS.map((item) => (
                <OptionCard
                  key={item.id}
                  type="radio"
                  name="payment-method"
                  title={item.label}
                  checked={method === item.id}
                  onChange={() => setMethod(item.id)}
                />
              ))}
            </OptionGroup>
            {method === "check" && (
              <Input label="Check number (optional)" value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)} />
            )}

            <Input
              label="Payment date"
              type="date"
              required
              max={today}
              value={date}
              hint="The date the business received the payment."
              error={showErrors ? dateError : undefined}
              onChange={(event) => setDate(event.target.value)}
            />
            <Textarea
              label="Internal note (optional)"
              rows={2}
              value={note}
              hint="Visible only to your team."
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <aside aria-label="Payment summary" className="h-fit space-y-3 rounded-card border border-line bg-surface-low p-4 text-sm">
            <h4 className="font-semibold text-ink">Payment summary</h4>
            <p className="text-xs text-ink-muted">After recording: {afterBalance === 0 ? "Paid" : "Partially paid"}</p>
            <KeyValueList
              items={[
                { label: "Invoice", value: `#${payable.id}` },
                { label: "Customer", value: getPartyName(payable, dir) },
                { label: "Related work", value: getRelatedWork(payable, dir.services) },
                { label: "Invoice total", value: usd(getInvoiceTotal(payable)) },
                { label: "Previously paid", value: usd(getInvoicePaid(payable, data)) },
                { label: "Payment being recorded", value: usd(amountError ? 0 : amount) },
                { label: "Balance after payment", value: usd(afterBalance) },
              ]}
            />
            <p className="text-xs text-ink-muted">This payment will be recorded separately and linked to Invoice #{payable.id}.</p>
            {problem && <FormAlert>{problem}</FormAlert>}
          </aside>
        </div>
      )}
    </Modal>
  );
}
