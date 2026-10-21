"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Mail, MapPin, Phone, ShieldCheck, Star, type LucideIcon } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { RequestReviewModal } from "@/components/reviews/RequestReviewModal";
import { useReviews } from "@/components/reviews/ReviewsProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { customerPropertiesHref } from "@/config/routes";
import { getPrimaryProperty, type Customer } from "@/data/customers";
import { toTelHref } from "@/lib/format";
import { eligibleReviewJobs } from "@/lib/review-rules";
import { PlanStatusText } from "./CustomerPlan";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan } from "@/components/workspace/WorkspaceProvider";

function InfoTile({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className={`${cardClasses("md")} flex items-center gap-3`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-primary-subtle text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{label}</div>
        <div className="truncate text-sm font-semibold text-ink">{children}</div>
      </div>
    </div>
  );
}

export function CustomerHeader({ customer }: { customer: Customer }) {
  const dir = useDirectory();
  const canBook = useCan("operations:manage");
  const canAskForReview = useCan("reviews:manage");
  const { data: operations } = useOperations();
  const { data: reviews } = useReviews();
  const [requesting, setRequesting] = useState(false);
  const property = getPrimaryProperty(customer, dir);
  // A review is asked for after work is done: only a customer with a completed Job that has no request yet is offered one.
  const canRequestReview = canAskForReview && eligibleReviewJobs(customer.id, operations, reviews.requests).length > 0;

  return (
    <div className="space-y-5">
      <div className={`${cardClasses("lg")} flex flex-col justify-between gap-5 lg:flex-row lg:items-center`}>
        <div className="flex items-center gap-4">
          <Avatar name={customer.name} size="xl" />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">{customer.name}</h1>
              <span className="rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-semibold text-primary capitalize">
                {customer.type} account
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">Preferred contact: {customer.preferredContact}</p>
          </div>
        </div>
        {/* What to do next with this customer: book a visit (the main thing), and ask for a review once there is finished work to ask about. */}
        {(canBook || canRequestReview) && (
          <div className="flex flex-wrap items-center gap-2">
            {canRequestReview && (
              <Button variant="secondary" onClick={() => setRequesting(true)}>
                <Star aria-hidden className="size-4" />
                Request review
              </Button>
            )}
            {canBook && <ButtonLink href={`/bookings?new=1&customer=${customer.id}`}>Create booking</ButtonLink>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoTile icon={Phone} label="Phone">
          {customer.phone ? (
            <a href={toTelHref(customer.phone)} className="hover:underline">
              {customer.phone}
            </a>
          ) : (
            "No phone on file"
          )}
        </InfoTile>
        <InfoTile icon={Mail} label="Email address">
          {customer.email ? (
            <a href={`mailto:${customer.email}`} className="hover:underline">
              {customer.email}
            </a>
          ) : (
            "No email on file"
          )}
        </InfoTile>
        <InfoTile icon={MapPin} label="Primary property">
          {property ? (
            <Link href={customerPropertiesHref(customer.id)} className="hover:underline">
              {property.street}, {property.city}
            </Link>
          ) : (
            "No property on file"
          )}
        </InfoTile>
        <InfoTile icon={ShieldCheck} label="Plan status">
          <PlanStatusText customer={customer} />
        </InfoTile>
      </div>
      {requesting && <RequestReviewModal onClose={() => setRequesting(false)} />}
    </div>
  );
}
