import Link from "next/link";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { BrandMark } from "@/components/website/BrandMark";
import type { ProviderCard as ProviderCardData } from "@/data/marketplace-discovery";
import { BOOKING_METHOD_ACTION, BOOKING_METHOD_LABEL, formatDuration, formatServicePrice } from "@/data/services";
import { bookingHref, profileHref, type DiscoveryContext } from "@/lib/marketplace-discovery";
import { Rating, plural } from "./Rating";

/** One cell of the nameplate: a small label over a plain value. */
function Plate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-low px-4 py-3">
      <dt className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * One provider in the results. Everything on it is the provider's public projection: its name, description and logo, the rating its public reviews
 * make, the Service the search matched with that Service's own price and booking method, and the places it listed. The foot of the card is a
 * nameplate, four plain facts in ruled cells: a card never shows a fact it does not have (no reviews says so; no listed places says so).
 *
 * The provider's name is the card's one link (stretched over the card); "Book" is a second, separate link on top of it.
 */
export function ProviderCard({ provider, context, headingLevel = "h3" }: { provider: ProviderCardData; context: DiscoveryContext; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  const { service } = provider;
  const place = provider.areas[0];
  const morePlaces = provider.areaCount - 1;
  const headingId = `provider-${provider.slug}`;
  // Carried to the profile so a booking made from it knows what the visitor was looking for.
  const lookedFor: DiscoveryContext = { service: service?.slug ?? context.service ?? null, location: context.location ?? null };

  return (
    <article aria-labelledby={headingId} className="@container relative overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow focus-within:shadow-overlay hover:shadow-overlay">
      <div className="flex items-start gap-4 p-5">
        <BrandMark name={provider.name} logo={provider.logo} tile="size-12 rounded-card text-base font-bold" image="h-12 max-w-40 rounded-card" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Heading id={headingId} className="text-base font-bold tracking-tight text-ink">
              <Link prefetch={false} href={profileHref(provider.slug, lookedFor)} className="after:absolute after:inset-0 after:content-[''] hover:text-primary">
                {provider.name}
              </Link>
            </Heading>
            {provider.rating && <Rating rating={provider.rating} />}
          </div>
          {provider.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{provider.description}</p>}
          {service && (
            <p className="mt-3 text-sm text-ink">
              <span className="font-semibold">{service.name}</span>
              <span className="text-ink-muted"> · {formatDuration(service.durationMinutes)}</span>
              {provider.serviceCount > 1 && <span className="text-ink-muted"> · {plural(provider.serviceCount, "service")} listed</span>}
            </p>
          )}
        </div>
      </div>

      <dl aria-label={`${provider.name}: at a glance`} className="grid grid-cols-2 gap-px border-t border-line bg-line @xl:grid-cols-4">
        <Plate label="Rating">{provider.rating ? `${provider.rating.average.toFixed(1)} · ${plural(provider.rating.count, "review")}` : <span className="font-medium text-ink-muted">No reviews yet</span>}</Plate>
        <Plate label={service ? "Price" : "Services"}>{service ? formatServicePrice(service.pricing) : plural(provider.serviceCount, "service")}</Plate>
        <Plate label="Booking">{service ? (provider.canBook ? BOOKING_METHOD_LABEL[service.bookingMethod] : <span className="font-medium text-ink-muted">Not online</span>) : <span className="font-medium text-ink-muted">Not online</span>}</Plate>
        <Plate label="Serves">
          {place ? (
            <>
              {place.display}
              {morePlaces > 0 && <span className="font-medium text-ink-muted"> +{morePlaces}</span>}
            </>
          ) : (
            <span className="font-medium text-ink-muted">Not listed</span>
          )}
        </Plate>
      </dl>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
          View profile
          <ArrowRight aria-hidden className="size-4" />
        </span>
        {service && provider.canBook && (
          <Link prefetch={false} href={bookingHref(provider.slug, service.slug, lookedFor)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <CalendarCheck aria-hidden className="size-4" />
            {BOOKING_METHOD_ACTION[service.bookingMethod]}
            <span className="sr-only"> with {provider.name}</span>
          </Link>
        )}
      </div>
    </article>
  );
}
