"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, Megaphone, Pencil, Plus, Send, Timer, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { CHANNEL_LABEL, getCampaignMetrics, type CampaignChannel, type CampaignStatus } from "@/data/marketing";
import { useMarketing } from "./MarketingProvider";
import { CampaignStatusBadge, ChannelBadge, audienceName, recipientsText, sendDateText } from "./marketing-ui";

type View = "all" | CampaignStatus;
const VIEWS: View[] = ["all", "draft", "scheduled", "sent"];
const ZERO = { drafts: 0, scheduled: 0, sent: 0, total: 0, recentRecipients: 0 };

export function MarketingView() {
  const { data } = useMarketing();
  const router = useRouter();
  const params = useSearchParams();
  const view: View = VIEWS.find((id) => id === params.get("tab")) ?? "all";
  // ?state=empty previews the approved empty state without having to remove every campaign.
  const previewEmpty = params.get("state") === "empty";

  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<"all" | CampaignChannel>("all");

  const campaigns = previewEmpty ? [] : data.campaigns;
  const metrics = previewEmpty ? ZERO : getCampaignMetrics(data);

  function setView(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === "all") next.delete("tab");
    else next.set("tab", id);
    setQuery("");
    setChannel("all");
    const qs = next.toString();
    router.replace((qs ? `/marketing?${qs}` : "/marketing") as Route, { scroll: false });
  }

  const needle = query.trim().toLowerCase();
  const visible = campaigns.filter(
    (campaign) =>
      (view === "all" || campaign.status === view) &&
      `${campaign.name} ${campaign.summary ?? ""}`.toLowerCase().includes(needle) &&
      (channel === "all" || campaign.channel === channel),
  );
  const filtering = needle !== "" || channel !== "all";
  const tabTotal = view === "all" ? metrics.total : view === "draft" ? metrics.drafts : view === "scheduled" ? metrics.scheduled : metrics.sent;

  return (
    <>
      <PageHeader
        title="Marketing"
        description="Create and manage customer email and SMS campaigns."
        actions={
          <ButtonLink href="/marketing/new" size="lg">
            <Plus aria-hidden className="size-[18px]" />
            Create campaign
          </ButtonLink>
        }
      />

      <section aria-label="Campaign totals" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Drafts" value={metrics.drafts} icon={FileText} hint="Campaigns being prepared" />
        <KpiCard label="Scheduled" value={metrics.scheduled} icon={Timer} hint="Campaign ready to send later" />
        <KpiCard label="Sent" value={metrics.sent} icon={Send} hint="Completed campaigns" />
        <KpiCard label="Recent recipients" value={metrics.recentRecipients} icon={Users} hint="Recipients across recent sends" />
      </section>

      <Card padding="md" className="space-y-4">
        <Tabs
          label="Campaign views"
          idPrefix="campaigns"
          value={view}
          onChange={setView}
          tabs={[
            { id: "all", label: "All campaigns", count: metrics.total },
            { id: "draft", label: "Drafts", count: metrics.drafts },
            { id: "scheduled", label: "Scheduled", count: metrics.scheduled },
            { id: "sent", label: "Sent", count: metrics.sent },
          ]}
        />

        {previewEmpty ? (
          <div role="tabpanel" id="campaigns-panel-all" aria-labelledby="campaigns-tab-all">
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="Create an Email or SMS campaign to communicate with existing customers."
              action={
                <ButtonLink href="/marketing/new" size="lg">
                  <Plus aria-hidden className="size-4" />
                  Create campaign
                </ButtonLink>
              }
            />
            <p className="mt-3 text-center text-xs text-ink-muted">Campaigns reach existing contacts from your Customers records.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <SearchInput
                wrapperClassName="min-w-60 flex-1"
                aria-label="Search campaigns"
                placeholder="Search campaign..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="w-44">
                <Select label="Channel" hideLabel value={channel} onChange={(event) => setChannel(event.target.value as "all" | CampaignChannel)}>
                  <option value="all">Channel: All</option>
                  {(Object.keys(CHANNEL_LABEL) as CampaignChannel[]).map((id) => (
                    <option key={id} value={id}>
                      {CHANNEL_LABEL[id]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div role="tabpanel" id={`campaigns-panel-${view}`} aria-labelledby={`campaigns-tab-${view}`} className="space-y-3">
              <Table aria-label="Campaigns">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Campaign</TableHeaderCell>
                    <TableHeaderCell>Channel</TableHeaderCell>
                    <TableHeaderCell>Audience</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Send date</TableHeaderCell>
                    <TableHeaderCell>Recipients</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                        {filtering ? "No campaigns match your filters." : "No campaigns to show."}
                      </td>
                    </tr>
                  ) : (
                    visible.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <Link href={`/marketing/${campaign.id}`} className="font-semibold text-ink hover:text-primary hover:underline">
                            {campaign.name}
                          </Link>
                          {campaign.summary && <p className="text-xs text-ink-muted">{campaign.summary}</p>}
                        </TableCell>
                        <TableCell>
                          <ChannelBadge channel={campaign.channel} />
                        </TableCell>
                        <TableCell className="text-ink-muted">{audienceName(campaign)}</TableCell>
                        <TableCell>
                          <CampaignStatusBadge status={campaign.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-ink-muted">{sendDateText(campaign, campaign.status === "scheduled")}</TableCell>
                        <TableCell className="font-semibold">{recipientsText(campaign)}</TableCell>
                        <TableCell className="text-right">
                          {campaign.status === "draft" ? (
                            <Link
                              href={`/marketing/${campaign.id}/edit`}
                              aria-label={`Edit campaign ${campaign.name}`}
                              className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary-subtle"
                            >
                              Edit campaign
                              <Pencil aria-hidden className="size-3.5" />
                            </Link>
                          ) : (
                            <Link
                              href={`/marketing/${campaign.id}`}
                              aria-label={`View campaign ${campaign.name}`}
                              className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary-subtle"
                            >
                              View campaign
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p aria-live="polite" className="text-xs text-ink-muted">
                Showing {visible.length} of {tabTotal} {view === "all" ? "total campaigns" : `${view === "draft" ? "draft" : view} campaigns`}
              </p>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
