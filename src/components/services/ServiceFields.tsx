"use client";

import { useState } from "react";
import { Clock, Tag } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  AUDIENCE_LABEL,
  BOOKING_METHOD_ARRIVAL,
  BOOKING_METHOD_DETAIL,
  BOOKING_METHOD_LABEL,
  PRICING_MODEL_DETAIL,
  PRICING_MODEL_LABEL,
  SERVICE_CATEGORIES,
  VISIBILITY_LABEL,
  formatDuration,
  formatServicePrice,
  type BookingMethod,
  type PricingModel,
  type Service,
  type ServiceAudience,
  type ServiceCategory,
  type ServiceVisibility,
} from "@/data/services";
import { NAME_MAX_LENGTH, withPricingModel, type ServiceErrors } from "./service-state";

/**
 * Field groups shared by the Service detail tabs and the Add Service wizard, so a rule like
 * "diagnostic fees need a label" is implemented once. Each takes the full service and returns the
 * next full service through onChange; nothing here owns state beyond transient text input.
 */
type FieldsProps = {
  service: Service;
  onChange: (next: Service) => void;
  errors?: ServiceErrors;
};

export function BasicsFields({ service, onChange, errors = {} }: FieldsProps) {
  function toggleAudience(audience: ServiceAudience, checked: boolean) {
    const next = checked ? [...service.audience, audience] : service.audience.filter((item) => item !== audience);
    onChange({ ...service, audience: next });
  }

  return (
    <div className="space-y-5">
      <Input
        label="Service name"
        required
        maxLength={NAME_MAX_LENGTH}
        value={service.name}
        error={errors.name}
        hint={errors.name ? undefined : `Visible to customers. Up to ${NAME_MAX_LENGTH} characters.`}
        onChange={(event) => onChange({ ...service, name: event.target.value })}
      />

      <Select
        label="Category"
        required
        value={service.category}
        onChange={(event) => onChange({ ...service, category: event.target.value as ServiceCategory })}
      >
        {SERVICE_CATEGORIES.map((category) => (
          <option key={category}>{category}</option>
        ))}
      </Select>

      <div>
        <OptionGroup legend="Target audience" hint="Defines which customers can book this service." className="sm:grid-cols-2">
          {(Object.keys(AUDIENCE_LABEL) as ServiceAudience[]).map((audience) => (
            <OptionCard
              key={audience}
              type="checkbox"
              title={AUDIENCE_LABEL[audience]}
              checked={service.audience.includes(audience)}
              onChange={(event) => toggleAudience(audience, event.target.checked)}
            />
          ))}
        </OptionGroup>
        {errors.audience && <p className="mt-1 text-xs text-danger">{errors.audience}</p>}
      </div>

      <Textarea
        label="Customer-facing description"
        required
        rows={4}
        value={service.description}
        error={errors.description}
        hint={errors.description ? undefined : `Shown on your website and booking flow. ${service.description.length} characters.`}
        onChange={(event) => onChange({ ...service, description: event.target.value })}
      />

      <Textarea
        label="Internal description"
        rows={3}
        value={service.internalDescription ?? ""}
        hint="Private to your team. Never shown to customers."
        onChange={(event) => onChange({ ...service, internalDescription: event.target.value || undefined })}
      />
    </div>
  );
}

export function PricingFields({ service, onChange, errors = {} }: FieldsProps) {
  const { pricing } = service;
  // The amount is edited as text so the field can be cleared; the numeric value is derived on every change.
  const [amountText, setAmountText] = useState(pricing.model !== "free-assessment" && pricing.amount > 0 ? String(pricing.amount) : "");

  function changeAmount(text: string) {
    setAmountText(text);
    if (pricing.model === "free-assessment") return;
    const amount = text.trim() === "" ? 0 : Number(text);
    onChange({ ...service, pricing: { ...pricing, amount: Number.isFinite(amount) ? amount : 0 } });
  }

  return (
    <div className="space-y-5">
      <OptionGroup
        legend="Customer-facing pricing mode"
        hint="How the fee is presented to the customer before booking."
        className="sm:grid-cols-3"
      >
        {(Object.keys(PRICING_MODEL_LABEL) as PricingModel[]).map((model) => (
          <OptionCard
            key={model}
            type="radio"
            name="pricing-model"
            title={PRICING_MODEL_LABEL[model]}
            description={PRICING_MODEL_DETAIL[model]}
            checked={pricing.model === model}
            onChange={() => onChange(withPricingModel(service, model))}
          />
        ))}
      </OptionGroup>

      {pricing.model !== "free-assessment" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={pricing.model === "fixed-price" ? "Price (USD)" : "Fee amount (USD)"}
            required
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={amountText}
            error={errors.amount}
            onChange={(event) => changeAmount(event.target.value)}
          />
          {pricing.model === "diagnostic-fee" && (
            <Input
              label="Price label"
              required
              value={pricing.label}
              error={errors.priceLabel}
              hint={errors.priceLabel ? undefined : "Shown after the amount, for example “diagnostic fee” or “call fee”."}
              onChange={(event) => onChange({ ...service, pricing: { ...pricing, label: event.target.value } })}
            />
          )}
        </div>
      )}
    </div>
  );
}

const DURATION_CHOICES = [30, 45, 60, 90, 120, 150, 180];

export function BookingFields({ service, onChange, errors = {} }: FieldsProps) {
  // Keep an existing duration selectable even if it isn't one of the standard choices.
  const durations = DURATION_CHOICES.includes(service.durationMinutes)
    ? DURATION_CHOICES
    : [...DURATION_CHOICES, service.durationMinutes].sort((a, b) => a - b);

  return (
    <div className="space-y-5">
      <OptionGroup legend="Booking method" hint="How customers book this service.">
        {(Object.keys(BOOKING_METHOD_LABEL) as BookingMethod[]).map((method) => (
          <OptionCard
            key={method}
            type="radio"
            name="booking-method"
            title={BOOKING_METHOD_LABEL[method]}
            description={`${BOOKING_METHOD_DETAIL[method]} (${BOOKING_METHOD_ARRIVAL[method]})`}
            checked={service.bookingMethod === method}
            onChange={() => onChange({ ...service, bookingMethod: method })}
          />
        ))}
      </OptionGroup>

      <div className="max-w-sm">
        <Select
          label="Estimated service duration"
          required
          value={service.durationMinutes}
          error={errors.duration}
          hint={errors.duration ? undefined : "On-site time reserved on the calendar for this service."}
          onChange={(event) => onChange({ ...service, durationMinutes: Number(event.target.value) })}
        >
          {durations.map((minutes) => (
            <option key={minutes} value={minutes}>
              {formatDuration(minutes)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

const VISIBILITY_DETAIL: Record<ServiceVisibility, string> = {
  "public-booking": "Listed on your website and bookable online.",
  "public-only": "Listed on your website. Customers contact you instead of booking online.",
  internal: "Only your team can use this service when creating bookings.",
};

export function VisibilityFields({ service, onChange }: FieldsProps) {
  return (
    <div className="space-y-5">
      <OptionGroup legend="Where customers can find this service" hint="Controls the public website and online booking.">
        {(Object.keys(VISIBILITY_LABEL) as ServiceVisibility[]).map((visibility) => (
          <OptionCard
            key={visibility}
            type="radio"
            name="service-visibility"
            title={VISIBILITY_LABEL[visibility]}
            description={VISIBILITY_DETAIL[visibility]}
            checked={service.visibility === visibility}
            onChange={() => onChange({ ...service, visibility })}
          />
        ))}
      </OptionGroup>

      <div className="max-w-xs">
        <Input
          label="Display order"
          type="number"
          min={1}
          step="1"
          value={service.displayOrder}
          hint="Position in the service list and booking picker. 1 is first."
          onChange={(event) => onChange({ ...service, displayOrder: Math.max(1, Math.floor(Number(event.target.value)) || 1) })}
        />
      </div>
    </div>
  );
}

/** What the customer sees for this service. Static: it has no actions of its own. */
export function ServicePreview({ service }: { service: Service }) {
  return (
    <section aria-label="Customer preview" className="rounded-card border border-line bg-canvas p-5">
      <p className="mb-3 text-micro font-bold tracking-wider text-ink-muted uppercase">Customer preview</p>
      <div className="rounded-card border border-line bg-surface p-4">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">
          {service.category}
        </span>
        <h3 className="mt-2 text-base font-semibold text-ink">{service.name || "Untitled service"}</h3>
        <p className="mt-1 line-clamp-3 text-sm text-ink-muted">
          {service.description || "Your customer-facing description appears here."}
        </p>
        <dl className="mt-3 space-y-1 text-xs text-ink-muted">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Price</dt>
            <Tag aria-hidden className="size-3.5" />
            <dd className="font-semibold text-ink">
              {service.pricing.model === "free-assessment" || service.pricing.amount > 0
                ? formatServicePrice(service.pricing)
                : "Price not set"}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Duration</dt>
            <Clock aria-hidden className="size-3.5" />
            <dd>{formatDuration(service.durationMinutes)}</dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
          Booking: <span className="font-semibold text-ink">{BOOKING_METHOD_LABEL[service.bookingMethod]}</span>
        </p>
      </div>
    </section>
  );
}
