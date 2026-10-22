"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { useOperations } from "@/components/operations/OperationsProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { StepList } from "@/components/ui/StepList";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useGuardedClose } from "@/components/ui/useGuardedClose";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useClock } from "@/components/workspace/WorkspaceProvider";
import { quoteHref } from "@/config/routes";
import { getCustomerById } from "@/data/customers";
import { getServiceNameFor } from "@/data/operations";
import { MAX_QUOTE_LINES } from "@/lib/financial-rules";
import { formatDate } from "@/lib/format";
import { fromCents, lineCents } from "@/lib/money";
import { BLANK_LINE, checkLines, lineForRequest, type QuoteLineDraft } from "@/lib/quote-form";
import { useFinancials } from "./FinancialProvider";
import { usd } from "./shared";

const STEPS = [
  { id: "customer", label: "Customer" },
  { id: "work", label: "Work" },
  { id: "price", label: "Price" },
  { id: "review", label: "Review" },
] as const;

/** How many customers the first step lists at once; typing in the search narrows the rest. */
const SHOWN = 8;

type Draft = {
  customerId?: string;
  serviceId: string;
  jobId: string;
  message: string;
  validThrough: string;
  lines: QuoteLineDraft[];
};

const EMPTY: Draft = { serviceId: "", jobId: "", message: "", validThrough: "", lines: [{ ...BLANK_LINE }] };

/**
 * The one Create quote flow: Customer, then the work being quoted, then the price, then a review. Nothing is stored until the last step; then the server checks that
 * the customer (and the job, if one is named) are this business's own, numbers the quote from the business's counter, adds the lines up in whole cents and stores it
 * as a draft. The total on the Review step is only what the person is shown: it is sent along so the server can refuse a request whose lines add up to something else.
 */
export function CreateQuoteModal({ onClose }: { onClose: () => void }) {
  const dir = useDirectory();
  const { data: operations } = useOperations();
  const { createQuote } = useFinancials();
  const router = useRouter();
  const { toast } = useToast();
  const { today } = useClock();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const dirty = stepIndex > 0 || draft.customerId !== undefined || JSON.stringify(draft) !== JSON.stringify(EMPTY);
  const { close, guard } = useGuardedClose(dirty && !saving, onClose, "this quote");

  const step = STEPS[stepIndex];
  const customer = draft.customerId ? getCustomerById(draft.customerId, dir) : undefined;
  const checked = checkLines(draft.lines);
  const jobs = operations.jobs.filter((candidate) => customer && candidate.customerId === customer.id);
  const job = jobs.find((candidate) => candidate.id === draft.jobId);
  const service = dir.services.find((candidate) => candidate.id === draft.serviceId);
  const dateProblem = draft.validThrough && draft.validThrough < today ? "Choose today or a later day." : undefined;

  const stepProblem: Record<(typeof STEPS)[number]["id"], boolean> = {
    customer: !customer,
    work: draft.message.length > 2000,
    price: checked.invalid || Boolean(dateProblem),
    review: false,
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setLine = (index: number, patch: Partial<QuoteLineDraft>) => update({ lines: draft.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) });
  const addLine = () => draft.lines.length < MAX_QUOTE_LINES && update({ lines: [...draft.lines, { ...BLANK_LINE }] });
  const removeLine = (index: number) => update({ lines: draft.lines.length === 1 ? [{ ...BLANK_LINE }] : draft.lines.filter((_, at) => at !== index) });

  function next() {
    if (stepProblem[step.id]) return setShowErrors(true);
    setShowErrors(false);
    setStepIndex((index) => index + 1);
  }

  async function create() {
    if (!customer || saving || checked.invalid) return;
    setSaving(true);
    setProblem(undefined);
    const result = await createQuote({
      customerId: customer.id,
      jobId: job?.id,
      serviceId: service?.id,
      validThrough: draft.validThrough || undefined,
      message: draft.message.trim() || undefined,
      expectedTotal: fromCents(checked.totalCents),
      lines: checked.lines.map(lineForRequest),
    });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    const made = result.data.quote;
    toast(`Quote #${made.id} was created as a draft for ${customer.name}. Nothing was sent. Give it to them, then mark it sent.`);
    onClose();
    router.push(quoteHref(made.id));
  }

  const needle = query.trim().toLowerCase();
  const found = dir.customers.filter((item) => `${item.name} ${item.phone} ${item.email}`.toLowerCase().includes(needle));
  const listed = found.slice(0, SHOWN);
  if (customer && !listed.some((item) => item.id === customer.id)) listed.unshift(customer);
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <>
      <Modal
        open
        onClose={close}
        size="xl"
        title="Create quote"
        description="Price work for one of your customers before you invoice it."
        footer={
          <ModalActions
            onCancel={close}
            back={
              stepIndex > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowErrors(false);
                    setStepIndex((index) => index - 1);
                  }}
                >
                  Back
                </Button>
              )
            }
          >
            {isLast ? (
              <Button onClick={create} disabled={saving}>
                {saving ? "Creating…" : "Create quote"}
              </Button>
            ) : (
              <Button onClick={next} disabled={step.id === "customer" && dir.customers.length === 0}>
                Next: {STEPS[stepIndex + 1].label}
              </Button>
            )}
          </ModalActions>
        }
      >
        <StepList steps={STEPS} current={stepIndex} label="Create quote steps" />

        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
          {step.id === "customer" && "Who is this quote for?"}
          {step.id === "work" && "What work are you quoting?"}
          {step.id === "price" && "What will it cost?"}
          {step.id === "review" && "Review quote"}
          <span className="sr-only">
            , step {stepIndex + 1} of {STEPS.length}
          </span>
        </h3>

        {step.id === "customer" &&
          (dir.customers.length === 0 ? (
            <div className="rounded-card bg-surface-low p-5">
              <p className="text-sm font-semibold text-ink">Add a customer first</p>
              <p className="mt-1 text-sm text-ink-muted">A quote is for one of your customers. Add the person you are pricing the work for, then come back to create the quote.</p>
              <Link href="/customers?new=1" onClick={onClose} className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">
                Add a customer
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <SearchInput aria-label="Search customers" value={query} onChange={(event) => setQuery(event.target.value)} />
              <OptionGroup legend="Customer" hint="Choose from your Customers.">
                {listed.map((item) => (
                  <OptionCard
                    key={item.id}
                    type="radio"
                    name="quote-customer"
                    title={item.name}
                    description={`${item.phone} · ${item.email}`}
                    checked={draft.customerId === item.id}
                    onChange={() => update({ customerId: item.id, jobId: "" })}
                  />
                ))}
              </OptionGroup>
              {found.length === 0 && <p className="text-sm text-ink-muted">No customer matches “{query.trim()}”.</p>}
              {found.length > SHOWN && <p className="text-xs text-ink-muted">Showing {SHOWN} of {found.length}. Search to narrow the list.</p>}
              {showErrors && !customer && (
                <p role="alert" className="text-xs text-danger">
                  Choose the customer this quote is for.
                </p>
              )}
            </div>
          ))}

        {step.id === "work" && (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Quote for <span className="font-semibold text-ink">{customer?.name}</span>. Both of these are optional; they only say what the quote is about.
            </p>
            <Select label="Service" hint="The Service this quote is mostly for." value={draft.serviceId} onChange={(event) => update({ serviceId: event.target.value })}>
              <option value="">No particular Service</option>
              {dir.services.filter((item) => item.active).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            {jobs.length > 0 ? (
              <Select label="Related job" hint="Link this quote to a job already on the list." value={draft.jobId} onChange={(event) => update({ jobId: event.target.value })}>
                <option value="">Not linked to a job</option>
                {jobs.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} · {getServiceNameFor(item, dir)} · {formatDate(item.date)}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-ink-muted">{customer?.name} has no jobs yet, so this quote is not linked to one.</p>
            )}
            <Textarea
              label="Note for the customer"
              hint="Optional. Shown with the quote."
              rows={3}
              maxLength={2000}
              value={draft.message}
              onChange={(event) => update({ message: event.target.value })}
            />
          </div>
        )}

        {step.id === "price" && (
          <div className="space-y-4">
            <ol aria-label="Line items" className="space-y-3">
              {draft.lines.map((line, index) => {
                const mine = checked.problems[index] ?? {};
                const single = checkLines([line]);
                const total = single.invalid ? undefined : single.lines[0].totalCents;
                return (
                  <li key={index} className="grid gap-3 rounded-card border border-line p-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_7rem_6rem_auto] sm:items-start">
                    <Input
                      label={`Description, line ${index + 1}`}
                      value={line.description}
                      maxLength={200}
                      error={showErrors ? mine.description : undefined}
                      onChange={(event) => setLine(index, { description: event.target.value })}
                    />
                    <Input
                      label="Quantity"
                      inputMode="decimal"
                      value={line.quantity}
                      error={showErrors ? mine.quantity : undefined}
                      onChange={(event) => setLine(index, { quantity: event.target.value })}
                    />
                    <Input
                      label="Price each ($)"
                      inputMode="decimal"
                      value={line.price}
                      error={showErrors ? mine.price : undefined}
                      onChange={(event) => setLine(index, { price: event.target.value })}
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">Line total</p>
                      <p className="mt-2 py-2 text-sm font-semibold text-ink tabular-nums">{total === undefined ? "—" : usd(fromCents(total))}</p>
                    </div>
                    <div className="sm:pt-7">
                      <Button variant="tertiary" onClick={() => removeLine(index)} aria-label={`Remove line ${index + 1}`}>
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="secondary" onClick={addLine} disabled={draft.lines.length >= MAX_QUOTE_LINES}>
                <Plus aria-hidden className="size-4" />
                Add line item
              </Button>
              <p className="text-sm text-ink-muted">
                Total <strong className="ml-1 text-lg text-ink tabular-nums">{usd(fromCents(checked.totalCents))}</strong>
              </p>
            </div>
            {showErrors && checked.empty && (
              <p role="alert" className="text-xs text-danger">
                Add at least one line item with a description and a price.
              </p>
            )}
            {showErrors && checked.tooLarge && (
              <p role="alert" className="text-xs text-danger">
                The total comes to more than one quote can hold. Check the quantities and prices.
              </p>
            )}
            <Input
              label="Price is good through"
              hint="Optional. The last day you will hold this price."
              type="date"
              min={today}
              value={draft.validThrough}
              error={showErrors ? dateProblem : undefined}
              onChange={(event) => update({ validThrough: event.target.value })}
            />
          </div>
        )}

        {step.id === "review" && (
          <div className="space-y-4">
            <KeyValueList
              className="rounded-card border border-line bg-surface-low p-4"
              items={[
                { label: "Customer", value: customer?.name ?? "" },
                { label: "Service", value: service?.name ?? "No particular Service" },
                { label: "Related job", value: job ? `#${job.id}` : "Not linked to a job" },
                { label: "Good through", value: draft.validThrough ? formatDate(draft.validThrough) : "No date set" },
              ]}
            />
            <Table aria-label="Quote line items to create">
              <TableHead>
                <tr>
                  <TableHeaderCell>Item</TableHeaderCell>
                  <TableHeaderCell>Qty</TableHeaderCell>
                  <TableHeaderCell className="text-right">Price each</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {checked.lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="whitespace-nowrap">{line.quantity}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{usd(fromCents(line.unitPriceCents))}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{usd(fromCents(lineCents(line.quantity, line.unitPriceCents)))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <KeyValueList
              className="ml-auto max-w-xs"
              items={[
                { label: "Subtotal", value: usd(fromCents(checked.totalCents)) },
                { label: "Tax", value: "Uses business tax settings" },
                { label: "Total", value: <strong>{usd(fromCents(checked.totalCents))}</strong> },
              ]}
            />
            {draft.message.trim() && <p className="text-sm text-ink italic">“{draft.message.trim()}”</p>}
            <p className="text-sm text-ink-muted">The quote is saved as a draft. Climvia does not send it for you: give it to your customer, then mark it sent.</p>
            {problem && <FormAlert>{problem}</FormAlert>}
          </div>
        )}
      </Modal>
      {guard}
    </>
  );
}
