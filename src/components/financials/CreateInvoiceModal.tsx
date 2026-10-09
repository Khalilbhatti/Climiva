"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { invoiceHref } from "@/config/routes";
import { PAYMENT_TERMS, getLineAmount, getLineItemsTotal, type PaymentTerms, type Quote } from "@/data/financials";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import { getPartyName } from "@/data/operations";
import { formatDate } from "@/lib/format";
import { useFinancials } from "./FinancialProvider";
import { usd } from "./shared";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/**
 * Create an invoice from an approved quote. The quote's details are shown for review first; creating adds an
 * unpaid invoice to this session's data (the number is assigned on creation). It never records a payment and
 * never changes the quote.
 */
export function CreateInvoiceModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const dir = useDirectory();
  const { createInvoiceFromQuote } = useFinancials();
  const { toast } = useToast();
  const router = useRouter();

  const [terms, setTerms] = useState<PaymentTerms>("due-on-receipt");
  const [message, setMessage] = useState("");
  const total = getLineItemsTotal(quote.lineItems);

  function create() {
    const invoice = createInvoiceFromQuote(quote.id, { terms, message });
    if (!invoice) return;
    toast(`Invoice #${invoice.id} created from Quote #${quote.id}.`);
    onClose();
    router.push(invoiceHref(invoice.id));
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Create invoice"
      description={`Create a billing record from approved Quote #${quote.id}. Review the invoice details before saving.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create}>Create invoice</Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="space-y-5">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Link2 aria-hidden className="size-4 text-primary" />
            From approved Quote #{quote.id}
            {quote.jobId && <> · Job #{quote.jobId}</>}
          </p>

          <section aria-labelledby="invoice-items">
            <h3 id="invoice-items" className="mb-2 text-sm font-semibold text-ink">
              Invoice items · {quote.lineItems.length} billable components
            </h3>
            <Table aria-label="Invoice items">
              <TableHead>
                <tr>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell>Qty / Hrs</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {quote.lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.description}</div>
                      {item.detail && <div className="text-xs text-ink-muted">{item.detail}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.quantity}
                      {item.unit && ` ${item.unit}`}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {usd(item.rate)}
                      {item.unit === "hrs" && "/hr"}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{usd(getLineAmount(item))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <KeyValueList
              className="mt-3 ml-auto max-w-xs"
              items={[
                { label: "Subtotal", value: usd(total) },
                { label: "Tax", value: usd(0) },
                { label: "Invoice total", value: <strong>{usd(total)}</strong> },
              ]}
            />
          </section>

          <section aria-labelledby="invoice-details" className="space-y-4">
            <h3 id="invoice-details" className="text-sm font-semibold text-ink">
              Invoice details
            </h3>
            <KeyValueList items={[{ label: "Invoice date", value: `Today (${formatDate(PROTOTYPE_TODAY)})` }]} />
            <Select label="Payment terms" value={terms} onChange={(event) => setTerms(event.target.value as PaymentTerms)}>
              {PAYMENT_TERMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Textarea
              label="Message to customer (optional)"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </section>
        </div>

        <aside aria-label="Invoice summary" className="h-fit space-y-3 rounded-card border border-line bg-surface-low p-4 text-sm">
          <h4 className="font-semibold text-ink">Billing summary</h4>
          <KeyValueList
            items={[
              { label: "Customer", value: getPartyName(quote, dir) },
              { label: "Source quote", value: `#${quote.id}` },
              ...(quote.jobId ? [{ label: "Related job", value: `#${quote.jobId}` }] : []),
              { label: "Invoice number", value: "Assigned when created" },
              { label: "Initial payment status", value: "Unpaid" },
            ]}
          />
          <div className="border-t border-line pt-3">
            <p className="text-micro font-bold tracking-wider text-ink-muted uppercase">Grand total due</p>
            <p className="text-2xl font-bold text-ink">{usd(total)}</p>
            <p className="text-xs text-ink-muted">Terms: {PAYMENT_TERMS.find((item) => item.id === terms)?.label}</p>
          </div>
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
            Payments are recorded separately after the invoice is created. Changes here affect this invoice only and don&rsquo;t modify Quote #
            {quote.id}.
          </p>
        </aside>
      </div>
    </Modal>
  );
}
