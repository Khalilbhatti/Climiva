"use client";

import { useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { getCustomerById } from "@/data/customers";
import { getServiceNameFor } from "@/data/operations";
import { DEFAULT_REQUEST_MESSAGE, REQUEST_MESSAGE_MAX, type ReviewRequestChannel } from "@/data/reviews";
import { formatDate } from "@/lib/format";
import { useReviews } from "./ReviewsProvider";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

const NO_JOB = "";

/**
 * Ask a customer for a review. This records the request and nothing else: nothing is sent, nothing is offered in
 * return, and no Marketing campaign is created. A request can be tied to one of the customer's completed jobs.
 */
export function RequestReviewModal({ onClose }: { onClose: () => void }) {
  const dir = useDirectory();
  const { addReviewRequest } = useReviews();
  const { data: ops } = useOperations();
  const { toast } = useToast();

  const [customerId, setCustomerId] = useState("sarah-mitchell");
  // null: nothing chosen yet, so the customer's most recent completed job is offered; "" is "No related job".
  const [jobChoice, setJobChoice] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReviewRequestChannel>("email");
  const [message, setMessage] = useState(DEFAULT_REQUEST_MESSAGE);
  const [showError, setShowError] = useState(false);

  const customer = getCustomerById(customerId, dir)!;
  const completed = ops.jobs
    .filter((job) => job.customerId === customerId && job.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const selectedJob = jobChoice === null ? completed[0] : completed.find((job) => job.id === jobChoice);
  const error = message.trim() === "" ? "Write the message the customer will receive." : undefined;

  function submit() {
    if (error) return setShowError(true);
    addReviewRequest({ customerId, relatedJobId: selectedJob?.id, channel, message });
    toast(`Review request recorded for ${customer.name} by ${channel === "email" ? "email" : "SMS"}. Nothing is sent.`);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Request a review"
      description="Send a review request to a customer after completed work."
      footer={
        <>
          <p className="mr-auto text-xs text-ink-muted">No incentives or rewards are included.</p>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Send review request</Button>
        </>
      }
    >
      <Select
        label="Customer"
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
        <p className="mt-1 text-xs text-ink-muted">Only completed jobs are available for review requests.</p>
      </div>

      <OptionGroup legend="Send by" hint="Available delivery methods use the contact details saved on this Customer record." className="sm:grid-cols-2">
        <OptionCard
          type="radio"
          name="review-channel"
          title="Email"
          description={
            <>
              <Mail aria-hidden className="mr-1 inline size-3" />
              {customer.email}
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
              {customer.phone}
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
    </Modal>
  );
}
