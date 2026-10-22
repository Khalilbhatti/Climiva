"use client";

import { useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { Button } from "@/components/ui/Button";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useGuardedClose } from "@/components/ui/useGuardedClose";
import { getCustomerById } from "@/data/customers";
import { getServiceNameFor } from "@/data/operations";
import { REQUEST_MESSAGE_MAX, defaultRequestMessage, type IssuedReviewLink, type ReviewRequestChannel } from "@/data/reviews";
import { formatDate } from "@/lib/format";
import { eligibleReviewJobs } from "@/lib/review-rules";
import { IssuedLinkView } from "./ReviewLink";
import { useReviews } from "./ReviewsProvider";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

const NO_JOB = "";

/**
 * Ask a customer for a review. This records the request in the database and makes a link the customer opens to write it: nothing is sent (the business
 * gives the customer the link), nothing is offered in return, and no Marketing campaign is created. The link is shown once, in the step after the request
 * is recorded. A request can be tied to one of the customer's completed jobs that has no request yet (the server holds that too, so asking twice about
 * the same work is refused).
 */
export function RequestReviewModal({ onClose }: { onClose: () => void }) {
  const dir = useDirectory();
  const { data: reviews, addReviewRequest } = useReviews();
  const { data: ops } = useOperations();
  const business = useBusiness();
  const { toast } = useToast();

  // The first customer with completed work to ask about, otherwise the first customer.
  const [customerId, setCustomerId] = useState(
    () => (dir.customers.find((item) => eligibleReviewJobs(item.id, ops, reviews.requests).length > 0) ?? dir.customers[0])?.id ?? "",
  );
  // null: nothing chosen yet, so the customer's most recent completed job is offered; "" is "No related job".
  const [jobChoice, setJobChoice] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReviewRequestChannel>("email");
  const [message, setMessage] = useState(() => defaultRequestMessage(business.name));
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  // Set once the request is recorded: the modal then shows its link, the one time it can be seen.
  const [issued, setIssued] = useState<{ link: IssuedReviewLink; customerName: string }>();

  // The one thing typed here is the message: changing it is work worth asking about before it is closed away.
  const { close, guard } = useGuardedClose(issued === undefined && !saving && message !== defaultRequestMessage(business.name), onClose, "this review request");

  const customer = customerId ? getCustomerById(customerId, dir) : undefined;
  const completed = eligibleReviewJobs(customerId, ops, reviews.requests);
  const selectedJob = jobChoice === null ? completed[0] : completed.find((job) => job.id === jobChoice);
  const error = message.trim() === "" ? "Write the message the customer will receive." : undefined;

  async function submit() {
    if (!customer || saving) return;
    if (error) return setShowError(true);
    setSaving(true);
    setProblem(undefined);
    const result = await addReviewRequest({ customerId, relatedJobId: selectedJob?.id, channel, message });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    toast(`Review request recorded for ${customer.name}. Nothing is sent, so give them the link.`);
    if (result.data.link) return setIssued({ link: result.data.link, customerName: customer.name });
    onClose();
  }

  if (issued) {
    return (
      <Modal
        open
        onClose={onClose}
        size="lg"
        title="Review link ready"
        description={`The request for ${issued.customerName} is recorded.`}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <IssuedLinkView link={issued.link} />
      </Modal>
    );
  }

  return (
    <>
      <Modal
        open
        onClose={close}
        size="lg"
        title="Request a review"
        description="Send a review request to a customer after completed work."
        footer={
          <ModalActions onCancel={close}>
            <Button onClick={submit} disabled={!customer || saving}>
              {saving ? "Recording…" : "Send review request"}
            </Button>
          </ModalActions>
        }
      >
        {dir.customers.length === 0 && <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">You have no customers yet. A review is requested from a customer on your list, once their work is done.</p>}
        <Select
          label="Customer"
          required
          hint="Select an existing customer from your records."
          value={customerId}
          onChange={(event) => {
            setCustomerId(event.target.value);
            setJobChoice(null);
          }}
        >
          {dir.customers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>

        <div>
          <Select label="Related job (optional)" value={selectedJob?.id ?? NO_JOB} onChange={(event) => setJobChoice(event.target.value)}>
            <option value={NO_JOB}>No related job</option>
            {completed.map((job) => (
              <option key={job.id} value={job.id}>
                #{job.id} · {getServiceNameFor(job, dir)} · Completed {formatDate(job.date)}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-muted">
            Only completed jobs are available for review requests.
            {customer && completed.length === 0 && ` ${customer.name} has no completed job waiting for a request yet. Ask once their work is done.`}
          </p>
        </div>

        <OptionGroup legend="Send by" hint="Available delivery methods use the contact details saved on this Customer record." className="sm:grid-cols-2">
          <OptionCard
            type="radio"
            name="review-channel"
            title="Email"
            description={
              <>
                <Mail aria-hidden className="mr-1 inline size-3" />
                {customer?.email || "No email on file"}
              </>
            }
            checked={channel === "email"}
            onChange={() => setChannel("email")}
          />
          <OptionCard
            type="radio"
            name="review-channel"
            title="SMS"
            description={
              <>
                <MessageSquare aria-hidden className="mr-1 inline size-3" />
                {customer?.phone || "No phone on file"}
              </>
            }
            checked={channel === "sms"}
            onChange={() => setChannel("sms")}
          />
        </OptionGroup>

        <Textarea
          label="Message"
          required
          rows={4}
          maxLength={REQUEST_MESSAGE_MAX}
          value={message}
          error={showError ? error : undefined}
          hint="Customer will receive this message along with a link to submit their feedback."
          onChange={(event) => setMessage(event.target.value)}
        />
        <p className="text-xs text-ink-muted">No incentives or rewards are included.</p>
        {problem && <FormAlert>{problem}</FormAlert>}
      </Modal>
      {guard}
    </>
  );
}
