"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useServices } from "@/components/services/ServicesProvider";
import { Switch } from "@/components/ui/Switch";
import { BOOKING_METHOD_LABEL, formatServicePrice } from "@/data/services";
import { getShownServices } from "@/data/website";
import { cn } from "@/lib/cn";
import { useBuilder } from "./BuilderProvider";

/**
 * Which of the business's Services the website shows, and in what order. It is one list for the whole website (a service section shows the
 * ones chosen here), kept as references to the Services by their slug: a Service's name, price, duration and booking method are never
 * copied into the website and are managed in the Services module.
 */
export function ServiceControls() {
  const b = useBuilder();
  const { services: catalog } = useServices();
  const value = b.content.settings.serviceDisplay;
  const ordered = getShownServices({ order: value.order, hidden: [] }, catalog);

  function move(id: string, by: -1 | 1) {
    const ids = ordered.map((service) => service.id);
    const index = ids.indexOf(id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    b.setServiceDisplay({ ...value, order: ids });
  }

  return (
    <div>
      <p className="mb-3 text-xs text-ink-muted">
        Choose which Services the website shows and in what order. This is one list for the whole website. Names, prices and booking methods always come from the Service catalog.
      </p>
      {ordered.length === 0 ? (
        <p className="rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">There are no public Services to show yet. Add one in Services.</p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((service, index) => {
            const shown = !value.hidden.includes(service.id);
            return (
              <li key={service.id} className="flex items-center gap-2 rounded-btn bg-surface-low px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", shown ? "text-ink" : "text-ink-muted")}>{service.name}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {formatServicePrice(service.pricing)} · {BOOKING_METHOD_LABEL[service.bookingMethod]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => move(service.id, -1)}
                  disabled={b.readOnly || index === 0}
                  aria-label={`Move ${service.name} up`}
                  className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
                >
                  <ArrowUp aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(service.id, 1)}
                  disabled={b.readOnly || index === ordered.length - 1}
                  aria-label={`Move ${service.name} down`}
                  className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
                >
                  <ArrowDown aria-hidden className="size-4" />
                </button>
                <Switch
                  checked={shown}
                  label={`Show ${service.name} on the website`}
                  disabled={b.readOnly}
                  onChange={(next) => b.setServiceDisplay({ ...value, hidden: next ? value.hidden.filter((id) => id !== service.id) : [...value.hidden, service.id] })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
