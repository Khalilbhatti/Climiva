import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import {
  INVOICE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  type InvoiceStatus,
  type PaymentStatus,
  type QuoteStatus,
} from "@/data/financials";

/**
 * The one place financial statuses map to a label and a tone (handoff taxonomy: mint = Approved / Paid /
 * Recorded, amber = Unpaid / Partially paid, red = Declined / Voided, grey = Draft / Expired). The label
 * always carries the meaning; colour only reinforces it.
 */
const QUOTE_TONE: Record<QuoteStatus, StatusTone> = {
  draft: "neutral",
  sent: "primary",
  approved: "positive",
  declined: "danger",
  expired: "neutral",
};

const INVOICE_TONE: Record<InvoiceStatus, StatusTone> = {
  paid: "positive",
  unpaid: "warning",
  "partially-paid": "warning",
};

const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  recorded: "positive",
  voided: "danger",
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <StatusBadge tone={QUOTE_TONE[status]}>{QUOTE_STATUS_LABEL[status]}</StatusBadge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <StatusBadge tone={INVOICE_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</StatusBadge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <StatusBadge tone={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</StatusBadge>;
}
