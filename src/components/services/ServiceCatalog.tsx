"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { serviceHref } from "@/config/routes";
import {
  BOOKING_METHOD_ARRIVAL,
  BOOKING_METHOD_LABEL,
  SERVICE_CATEGORIES,
  VISIBILITY_LABEL,
  formatAudience,
  formatDuration,
  formatServicePrice,
  getServices,
  type BookingMethod,
  type Service,
  type ServiceCategory,
  type ServiceVisibility,
} from "@/data/services";
import { AddServiceModal } from "./AddServiceModal";
import { useServices } from "./ServicesProvider";
import { ServicesEmptyState } from "./ServicesEmptyState";

type Filters = {
  query: string;
  category: "all" | ServiceCategory;
  method: "all" | BookingMethod;
  visibility: "all" | ServiceVisibility;
  status: "all" | "active" | "inactive";
};

const NO_FILTERS: Filters = { query: "", category: "all", method: "all", visibility: "all", status: "all" };

function matches(service: Service, filters: Filters): boolean {
  const query = filters.query.trim().toLowerCase();
  return (
    (!query || `${service.name} ${service.description}`.toLowerCase().includes(query)) &&
    (filters.category === "all" || service.category === filters.category) &&
    (filters.method === "all" || service.bookingMethod === filters.method) &&
    (filters.visibility === "all" || service.visibility === filters.visibility) &&
    (filters.status === "all" || service.active === (filters.status === "active"))
  );
}

export function ServiceCatalog() {
  const { services, addService } = useServices();
  const { toast } = useToast();
  const router = useRouter();
  // "?state=empty" previews the approved empty state without needing to delete the catalog.
  const previewEmpty = useSearchParams().get("state") === "empty";

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [adding, setAdding] = useState(false);
  const openWizard = () => setAdding(true);

  const catalog = useMemo(() => (previewEmpty ? [] : getServices(services)), [previewEmpty, services]);
  const visible = useMemo(() => catalog.filter((service) => matches(service, filters)), [catalog, filters]);
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const activeCount = catalog.filter((service) => service.active).length;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader
        title="Services"
        description="Manage the HVAC services customers can book and your team can perform."
        // The empty state carries its own primary action, so the header one is hidden to keep a single CTA.
        actions={
          catalog.length > 0 && (
            <Button size="lg" onClick={openWizard}>
              <Plus aria-hidden className="size-[18px]" />
              Add service
            </Button>
          )
        }
      />

      {catalog.length === 0 ? (
        <ServicesEmptyState onAdd={openWizard} onLoadStarter={() => router.replace("/services")} />
      ) : (
        <div className="space-y-4">
          <Card padding="md">
            <div className="flex flex-wrap items-end gap-3">
              <SearchInput
                wrapperClassName="min-w-60 flex-1"
                aria-label="Search services"
                placeholder="Search services..."
                value={filters.query}
                onChange={(event) => set("query", event.target.value)}
              />
              <div className="w-48">
                <Select label="Category" hideLabel value={filters.category} onChange={(e) => set("category", e.target.value as Filters["category"])}>
                  <option value="all">All categories</option>
                  {SERVICE_CATEGORIES.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </Select>
              </div>
              <div className="w-48">
                <Select label="Booking method" hideLabel value={filters.method} onChange={(e) => set("method", e.target.value as Filters["method"])}>
                  <option value="all">All booking methods</option>
                  {(Object.keys(BOOKING_METHOD_LABEL) as BookingMethod[]).map((method) => (
                    <option key={method} value={method}>
                      {BOOKING_METHOD_LABEL[method]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-48">
                <Select label="Visibility" hideLabel value={filters.visibility} onChange={(e) => set("visibility", e.target.value as Filters["visibility"])}>
                  <option value="all">All visibility</option>
                  {(Object.keys(VISIBILITY_LABEL) as ServiceVisibility[]).map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {VISIBILITY_LABEL[visibility]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-48">
                <Select label="Status" hideLabel value={filters.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
              {filtering && (
                <Button variant="tertiary" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              )}
            </div>
          </Card>

          <Table aria-label="Services">
            <TableHead>
              <tr>
                <TableHeaderCell>Service</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Booking method</TableHeaderCell>
                <TableHeaderCell>Duration</TableHeaderCell>
                <TableHeaderCell>Pricing</TableHeaderCell>
                <TableHeaderCell>Visibility</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                    No services match your filters.
                  </td>
                </tr>
              ) : (
                visible.map((service) => (
                  <TableRow key={service.id} className={service.active ? undefined : "bg-surface-low/60"}>
                    <TableCell className="max-w-sm">
                      <Link
                        href={serviceHref(service.id)}
                        className="font-semibold text-primary hover:underline"
                      >
                        {service.name}
                      </Link>
                      <div className="text-xs text-ink-muted">{formatAudience(service.audience)}</div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{service.description}</p>
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {service.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{BOOKING_METHOD_LABEL[service.bookingMethod]}</div>
                      <div className="text-xs text-ink-muted">{BOOKING_METHOD_ARRIVAL[service.bookingMethod]}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDuration(service.durationMinutes)}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{formatServicePrice(service.pricing)}</TableCell>
                    <TableCell className="text-xs">{VISIBILITY_LABEL[service.visibility]}</TableCell>
                    <TableCell>
                      <StatusBadge tone={service.active ? "positive" : "neutral"}>
                        {service.active ? "Active" : "Inactive"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <p aria-live="polite" className="text-xs text-ink-muted">
            Showing {visible.length} of {catalog.length} services · {activeCount} active
          </p>
        </div>
      )}

      <AddServiceModal
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(service) => {
          addService(service);
          setAdding(false);
          toast(`${service.name} added for this session. Reloading restores the standard catalog.`);
          if (previewEmpty) router.replace("/services");
        }}
      />
    </>
  );
}
