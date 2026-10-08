"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { CUSTOMERS, getCustomerById } from "@/data/customers";
import { getAudience, type AudienceId, type CampaignChannel } from "@/data/marketing";

type RecipientsModalProps = {
  channel: CampaignChannel;
  audienceId: AudienceId;
  selectedCustomerIds?: readonly string[];
  /** The campaign's recipient count. */
  count?: number;
  onClose: () => void;
};

/**
 * Who a campaign is for. The audience sizes are approved aggregates; the people listed are the customers in the
 * Customers records, as a sample. Email goes to the address on the customer record, SMS to the phone number.
 */
export function RecipientsModal({ channel, audienceId, selectedCustomerIds = [], count, onClose }: RecipientsModalProps) {
  const people =
    audienceId === "selected" ? selectedCustomerIds.map((id) => getCustomerById(id)).filter((customer) => customer !== undefined) : [...CUSTOMERS];

  return (
    <Modal
      open
      onClose={onClose}
      title="Recipients"
      description={`${getAudience(audienceId).label}${count === undefined ? "" : ` · ${count} recipients`}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {people.length === 0 ? (
        <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No customers have been chosen yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-card border border-line">
            {people.map((customer) => (
              <li key={customer.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">{customer.name}</span>
                <span className="text-ink-muted">{channel === "email" ? customer.email : customer.phone}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">
            Showing {people.length} sample records{count === undefined ? "" : ` of ${count} recipients`}.{" "}
            {channel === "email"
              ? "Customers without an email address will not receive this campaign."
              : "Customers without a phone number will not receive this campaign."}
          </p>
        </>
      )}
    </Modal>
  );
}
