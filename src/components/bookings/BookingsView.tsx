"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { Link2, Plus } from "lucide-react";
import { useMaintenancePlans } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { useOperations } from "@/components/operations/OperationsProvider";
import { BookingStatusBadge } from "@/components/operations/StatusBadges";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { useWebsite } from "@/components/website/WebsiteProvider";
import { cn } from "@/lib/cn";
import { formatPropertyAddress, getCustomerById, getPropertyById } from "@/data/customers";
import { getPlanVisitForBooking } from "@/data/maintenance-plans";
import {
  BOOKING_SOURCES,
  BOOKING_TABS,
  getBookingById,
  getPartyName,
  getServiceNameFor,
  type Booking,
  type BookingSource,
  type BookingTabId,
} from "@/data/operations";
import { BOOKING_METHOD_LABEL, getServiceById } from "@/data/services";
import { getPrimaryDomain, getWebsitePage } from "@/data/website";
import { formatLocalDateTime, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { BookingDrawer } from "./BookingDrawer";
import { CreateBookingModal } from "./CreateBookingModal";
import type { Directory } from "@/data/directory";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

const EMPTY_COPY: Record<BookingTabId, string> = {
  requests: "No requests are waiting for confirmation.",
  upcoming: "No upcoming bookings.",
  past: "No past bookings.",
  cancelled: "No cancelled bookings.",
};

function matchesQuery(booking: Booking, query: string, dir: Directory): boolean {
  const customer = booking.customerId ? getCustomerById(booking.customerId, dir) : undefined;
  const property = getPropertyById(booking.propertyId ?? "", dir);
  const haystack = [
    getPartyName(booking, dir),
    getServiceNameFor(booking, dir),
    customer?.phone ?? "",
    customer?.email ?? "",
    property ? formatPropertyAddress(property) : "",
    booking.id,
    booking.note ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function BookingsView() {
  const dir = useDirectory();
  const { data } = useOperations();
  const { data: plans } = useMaintenancePlans();
  const { toast } = useToast();
  const { site } = useWebsite();
  const router = useRouter();
  const params = useSearchParams();

  // Tab, selected booking and the create flow live in the URL so each is deep-linkable
  // (Overview's "New booking" opens /bookings?new=1; the Schedule links to ?booking=…).
  const tabId = BOOKING_TABS.find((tab) => tab.id === params.get("tab"))?.id ?? "requests";
  const selectedId = params.get("booking");
  const creating = params.get("new") === "1";
  const presetCustomerId = params.get("customer") ?? undefined;

  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | BookingSource>("all");

  function setParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace((qs ? `/bookings?${qs}` : "/bookings") as Route, { scroll: false });
  }

  const tabs = BOOKING_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: data.bookings.filter((booking) => booking.status === tab.status).length,
  }));

  const activeTab = BOOKING_TABS.find((tab) => tab.id === tabId)!;
  const tabBookings = useMemo(() => {
    const inTab = data.bookings.filter((booking) => booking.status === activeTab.status);
    const ascending = tabId === "requests" || tabId === "upcoming";
    return inTab.sort((a, b) => {
      const order = `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`);
      return ascending ? order : -order;
    });
  }, [data.bookings, activeTab.status, tabId]);

  const visible = tabBookings.filter(
    (booking) =>
      matchesQuery(booking, query, dir) &&
      (serviceFilter === "all" || booking.serviceId === serviceFilter) &&
      (sourceFilter === "all" || booking.source === sourceFilter),
  );
  const filtering = query.trim() !== "" || serviceFilter !== "all" || sourceFilter !== "all";

  const selected = selectedId ? getBookingById(selectedId, data) : undefined;
  const compact = Boolean(selected);

  async function copyBookingLink() {
    const url = `https://${getPrimaryDomain(site.domain)}${getWebsitePage("booking")?.path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Booking link copied to clipboard.");
    } catch {
      toast(`Copy this booking link: ${url}`);
    }
  }

  function closeDrawer() {
    const id = selectedId;
    setParams({ booking: null });
    // Return focus to the row's Review button that opened the panel.
    requestAnimationFrame(() => document.getElementById(`review-${id}`)?.focus());
  }

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Review customer requests, confirm appointments and manage upcoming bookings."
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={copyBookingLink}>
              <Link2 aria-hidden className="size-[18px]" />
              Copy booking link
            </Button>
            <Button size="lg" onClick={() => setParams({ new: "1" })}>
              <Plus aria-hidden className="size-[18px]" />
              Create booking
            </Button>
          </>
        }
      />

      <Card padding="md" className="space-y-4">
        <Tabs
          label="Booking lists"
          idPrefix="bookings"
          tabs={tabs}
          value={tabId}
          onChange={(id) => setParams({ tab: id, booking: null })}
        />

        <div className="flex flex-wrap items-end gap-3">
          <SearchInput
            wrapperClassName="min-w-60 flex-1"
            aria-label="Search bookings"
            placeholder="Search customer, service, phone or address..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="w-52">
            <Select label="Service" hideLabel value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
              <option value="all">Service: All</option>
              {dir.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-52">
            <Select label="Source" hideLabel value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | BookingSource)}>
              <option value="all">Source: All sources</option>
              {BOOKING_SOURCES.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </Select>
          </div>
          {filtering && (
            <Button
              variant="tertiary"
              onClick={() => {
                setQuery("");
                setServiceFilter("all");
                setSourceFilter("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div
          role="tabpanel"
          id={`bookings-panel-${tabId}`}
          aria-labelledby={`bookings-tab-${tabId}`}
          className={cn("gap-5", compact ? "grid grid-cols-[minmax(0,1fr)] items-start xl:grid-cols-[minmax(0,1fr)_24rem]" : "block")}
        >
          <div className="space-y-3">
            <Table aria-label={`${activeTab.label} bookings`} className="[&_td]:px-3 [&_th]:px-3">
              <TableHead>
                <tr>
                  <TableHeaderCell>Customer</TableHeaderCell>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>{tabId === "requests" ? "Requested time" : "Time"}</TableHeaderCell>
                  {!compact && <TableHeaderCell>Booking method</TableHeaderCell>}
                  {!compact && <TableHeaderCell>Source</TableHeaderCell>}
                  <TableHeaderCell>Status</TableHeaderCell>
                  {!compact && <TableHeaderCell>Received</TableHeaderCell>}
                  <TableHeaderCell>
                    <span className="sr-only">Action</span>
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
                      {filtering ? "No bookings match your search." : EMPTY_COPY[tabId]}
                    </td>
                  </tr>
                ) : (
                  visible.map((booking) => {
                    const name = getPartyName(booking, dir);
                    const service = getServiceById(booking.serviceId, dir.services);
                    const isSelected = booking.id === selectedId;
                    return (
                      <TableRow key={booking.id} className={isSelected ? "bg-primary-subtle/50" : undefined}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar name={name} />
                            <span className="font-semibold whitespace-nowrap text-ink">{name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-56">
                          <div className="font-medium">{getServiceNameFor(booking, dir)}</div>
                          {booking.note && <div className="text-xs text-ink-muted">{booking.note}</div>}
                          {(() => {
                            const included = getPlanVisitForBooking(booking, plans);
                            return included ? (
                              <div className="text-xs text-ink-muted">
                                {included.plan.name} · Visit {included.visit.sequence} of {included.plan.visitsPerYear}
                              </div>
                            ) : null;
                          })()}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="font-medium">{formatWeekdayDate(booking.date)}</div>
                          <div className="text-xs text-ink-muted">{formatTimeRange(booking.start, booking.end)}</div>
                        </TableCell>
                        {!compact && <TableCell>{service ? BOOKING_METHOD_LABEL[service.bookingMethod] : "—"}</TableCell>}
                        {!compact && <TableCell>{booking.source ?? "—"}</TableCell>}
                        <TableCell>
                          <BookingStatusBadge status={booking.status} />
                        </TableCell>
                        {!compact && (
                          <TableCell className="whitespace-nowrap text-xs text-ink-muted">
                            {booking.receivedAt ? formatLocalDateTime(booking.receivedAt) : "—"}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <button
                            type="button"
                            id={`review-${booking.id}`}
                            aria-label={`Review booking ${booking.id} for ${name}`}
                            aria-pressed={isSelected}
                            onClick={() => setParams({ booking: booking.id })}
                            className="rounded-btn px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary-subtle"
                          >
                            Review
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <p aria-live="polite" className="text-xs text-ink-muted">
              Showing {visible.length} of {tabBookings.length} {tabId === "requests" ? "pending" : activeTab.label.toLowerCase()} booking
              {tabBookings.length === 1 ? "" : "s"}
            </p>
          </div>

          {selected && <BookingDrawer booking={selected} onClose={closeDrawer} onTabChange={(id) => setParams({ tab: id })} />}
        </div>
      </Card>

      {creating && (
        <CreateBookingModal
          presetCustomerId={presetCustomerId}
          onClose={() => setParams({ new: null, customer: null })}
          onFinished={(booking) => setParams({ new: null, customer: null, tab: "upcoming", booking: booking.id })}
        />
      )}
    </>
  );
}
