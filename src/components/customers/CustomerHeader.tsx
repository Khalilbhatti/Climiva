import Link from "next/link";
import { Mail, MapPin, Phone, ShieldCheck, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { customerPropertiesHref } from "@/config/routes";
import { getPrimaryProperty, type Customer } from "@/data/customers";
import { toTelHref } from "@/lib/format";
import { PlanStatusText } from "./CustomerPlan";

function InfoTile({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
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
  const property = getPrimaryProperty(customer);

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
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/quotes-invoices" variant="secondary">
            Create quote
          </ButtonLink>
          <ButtonLink href="/jobs" variant="secondary">
            New job
          </ButtonLink>
          <ButtonLink href={`/bookings?new=1&customer=${customer.id}`}>New booking</ButtonLink>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoTile icon={Phone} label="Phone">
          <a href={toTelHref(customer.phone)} className="hover:underline">
            {customer.phone}
          </a>
        </InfoTile>
        <InfoTile icon={Mail} label="Email address">
          <a href={`mailto:${customer.email}`} className="hover:underline">
            {customer.email}
          </a>
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
    </div>
  );
}
