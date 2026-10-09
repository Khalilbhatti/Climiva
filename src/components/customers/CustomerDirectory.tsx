"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMaintenancePlans } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import {
  describeLastService,
  formatPropertyAddress,
  formatPropertyCityLine,
  getPrimaryProperty,
  type Customer,
} from "@/data/customers";
import { customerHref } from "@/config/routes";
import { getCustomerPlanSummary } from "@/data/maintenance-plans";
import { PlanBadge } from "./CustomerPlan";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Directory } from "@/data/directory";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

type PlanFilter = "all" | "active" | "none";

function matchesQuery(customer: Customer, query: string, dir: Directory): boolean {
  const property = getPrimaryProperty(customer, dir);
  const haystack = [customer.name, customer.phone, customer.email, property ? formatPropertyAddress(property) : ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function CustomerDirectory({ customers }: { customers: readonly Customer[] }) {
  const dir = useDirectory();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const { data: plans } = useMaintenancePlans();

  const visible = useMemo(
    () =>
      customers.filter(
        (customer) =>
          matchesQuery(customer, query, dir) &&
          (plan === "all" || (plan === "active") === (getCustomerPlanSummary(customer, plans) !== undefined)),
      ),
    [customers, query, plan, plans, dir],
  );

  const filtering = query.trim() !== "" || plan !== "all";

  return (
    <div className="space-y-4">
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <SearchInput
            wrapperClassName="min-w-72 flex-1"
            aria-label="Search customers"
            placeholder="Search customer, phone, email, or address..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="w-44">
            <Select
              label="Maintenance plan"
              hideLabel
              value={plan}
              onChange={(event) => setPlan(event.target.value as PlanFilter)}
            >
              <option value="all">All plans</option>
              <option value="active">Active plan</option>
              <option value="none">No plan</option>
            </Select>
          </div>
          {filtering && (
            <Button
              variant="tertiary"
              onClick={() => {
                setQuery("");
                setPlan("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      <Table aria-label="Customers" className="[&_td]:px-3 [&_th]:px-3">
        <TableHead>
          <tr>
            <TableHeaderCell>Customer</TableHeaderCell>
            <TableHeaderCell>Primary property</TableHeaderCell>
            <TableHeaderCell>Contact</TableHeaderCell>
            <TableHeaderCell>Last service</TableHeaderCell>
            <TableHeaderCell>Upcoming</TableHeaderCell>
            <TableHeaderCell>Maintenance plan</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Action</span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                No customers match your search.
              </td>
            </tr>
          ) : (
            visible.map((customer) => {
              const property = getPrimaryProperty(customer, dir);
              const lastService = describeLastService(customer, dir.services);
              return (
                <TableRow key={customer.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={customer.name} />
                      <div>
                        <div className="font-semibold whitespace-nowrap text-ink">{customer.name}</div>
                        <div className="text-xs text-ink-muted capitalize">{customer.type}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {property && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{property.street}</span>
                          <span className="rounded bg-surface-low px-1.5 py-0.5 text-mini font-medium text-ink-muted">
                            {property.label}
                          </span>
                        </div>
                        <div className="text-xs text-ink-muted">
                          {formatPropertyCityLine(property)}
                          {property.area && ` (${property.area})`}
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{customer.phone}</div>
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      {customer.email}
                      <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-mini font-semibold text-primary">
                        {customer.preferredContact}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {customer.lastService ? (
                      <>
                        <div className="font-medium">{formatDate(customer.lastService.date)}</div>
                        <div className="text-xs text-ink-muted">
                          {lastService}
                          {customer.lastService.jobId && ` (#${customer.lastService.jobId})`}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-ink-muted">No service yet</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {customer.upcoming ? (
                      <>
                        <div className="font-medium text-primary">{formatDateTime(customer.upcoming.at)}</div>
                        <div className="text-xs text-ink-muted">{customer.upcoming.summary}</div>
                      </>
                    ) : (
                      <span className="text-xs text-ink-muted">None scheduled</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PlanBadge customer={customer} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={customerHref(customer.id)}
                      aria-label={`View customer ${customer.name}`}
                      className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                    >
                      View customer
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <p aria-live="polite" className="text-xs text-ink-muted">
        Showing {visible.length} of {customers.length} customers
      </p>
    </div>
  );
}
