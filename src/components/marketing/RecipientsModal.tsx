"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getAudience, type AudienceId, type CampaignChannel } from "@/data/marketing";
import { send } from "@/lib/send-action";
import { campaignRecipientsAction, previewRecipientsAction, type RecipientList } from "@/server/actions/marketing-reads";

type RecipientsModalProps = {
  channel: CampaignChannel;
  audienceId: AudienceId;
  selectedCustomerIds?: readonly string[];
  /** The campaign's recipient count. */
  count?: number;
  /** A Scheduled or Sent campaign: its recipient snapshot is read instead of resolving the audience again. */
  campaignId?: string;
  onClose: () => void;
};

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; list: RecipientList };

/**
 * Who a campaign is for, asked of the server when the dialog opens (the people and their contact details are not part of the page
 * until someone asks). A Scheduled or Sent campaign shows its recipient snapshot: the people and contact details it was scheduled
 * or sent with, whatever has changed on the Customers records since. A Draft, or a campaign being edited, shows the audience as it
 * resolves right now from this business's own customers. Email goes to the address on the record, SMS to the phone number.
 */
export function RecipientsModal({ channel, audienceId, selectedCustomerIds = [], count, campaignId, onClose }: RecipientsModalProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const selectedKey = selectedCustomerIds.join(",");

  useEffect(() => {
    let current = true;
    const ask = campaignId
      ? send(() => campaignRecipientsAction({ id: campaignId }))
      : send(() => previewRecipientsAction({ channel, audienceId, selectedCustomerIds: selectedKey === "" ? [] : selectedKey.split(",") }));
    void ask.then((result) => {
      if (current) setState(result.ok ? { status: "ready", list: result.data } : { status: "error", message: result.error });
    });
    return () => {
      current = false;
    };
  }, [campaignId, channel, audienceId, selectedKey]);

  const listed = state.status === "ready" ? state.list.people.length : 0;
  const total = state.status === "ready" ? state.list.total : count;

  return (
    <Modal
      open
      onClose={onClose}
      title="Recipients"
      description={`${getAudience(audienceId).label}${total === undefined ? "" : ` · ${total} recipients`}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {state.status === "loading" ? (
        <p role="status" className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
          Loading recipients…
        </p>
      ) : state.status === "error" ? (
        <p role="alert" className="rounded-card bg-danger-soft p-4 text-sm text-danger">
          {state.message}
        </p>
      ) : listed === 0 ? (
        <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
          {audienceId === "selected"
            ? "No customers have been chosen yet."
            : state.list.total > 0
              ? `No customer records are listed for this audience. Its ${state.list.total} recipients are contacts imported from before customer records were kept here: they are counted, not listed.`
              : "No customers match this audience yet."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-card border border-line">
            {state.list.people.map((person, index) => (
              <li key={`${person.customerId ?? person.name}-${index}`} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">{person.name}</span>
                <span className="text-ink-muted">{person.destination}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">
            {listed < state.list.total ? `Showing ${listed} sample records of ${state.list.total} recipients.` : `Showing all ${state.list.total} recipients.`}{" "}
            {state.list.source === "snapshot" ? "These are the contact details the campaign was scheduled with. " : ""}
            {channel === "email" ? "Customers without an email address will not receive this campaign." : "Customers without a phone number will not receive this campaign."}
          </p>
        </>
      )}
    </Modal>
  );
}
