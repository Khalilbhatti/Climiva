"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, BadgeCheck, CalendarCheck, EyeOff, Info, MapPin, Pencil, Phone, Plus, Rocket, ShieldAlert, SquareArrowOutUpRight, Store, Wrench } from "lucide-react";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { publicListingHref } from "@/lib/site-domain";
import { useToast } from "@/components/ui/Toast";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { formatCityStateZip } from "@/lib/format";
import {
  LISTING_STATUS_LABEL,
  getEligibleServices,
  getListingServices,
  isAnyContactShown,
  type ListingStatus,
} from "@/data/marketplace";
import { areaDisplay } from "@/lib/marketplace-discovery";
import { ListingView } from "./ListingView";
import { useListingData } from "./listing-data";
import { useMarketplace } from "./MarketplaceProvider";
import { SuspendedNotice } from "./SuspendedNotice";
import { useServices } from "@/components/services/ServicesProvider";

const STATUS_TONE: Record<ListingStatus, StatusTone> = { "not-set-up": "neutral", published: "positive", hidden: "neutral" };

export function MarketplaceOverview() {
  const { listing, publishListing } = useMarketplace();
  const business = useBusiness();
  const { toast } = useToast();
  const canManage = useCan("marketplace:manage");
  // ?state=empty previews the first-time state without having to remove a listing.
  const status: ListingStatus = useSearchParams().get("state") === "empty" ? "not-set-up" : listing.status;

  const { config } = listing;
  const data = useListingData(config);
  const { services: catalog } = useServices();
  const eligible = getEligibleServices(catalog);
  const shown = getListingServices(config, catalog);
  const notSelected = eligible.filter((service) => !config.selected.includes(service.id));
  const configured = status !== "not-set-up";
  // Suspended by the platform: still the business's listing and still published, but nobody outside can find it. The reason is never known here.
  const suspended = listing.suspended && configured;
  // Every booking a visitor made from the Marketplace is recorded with its source, so the count is the real number, not an estimate.
  const { data: operations } = useOperations();
  const marketplaceBookings = operations.bookings.filter((booking) => booking.source === "Marketplace").length;

  async function publish() {
    const result = await publishListing();
    toast(result.ok ? "Marketplace listing published." : result.error);
  }

  // One main action for the state the listing is in: set it up (the empty state carries that one), publish it, or look at it as homeowners do.
  const actions =
    status === "published" ? (
      <>
        {canManage && (
          <ButtonLink href="/marketplace-listing/edit" variant="secondary" size="lg">
            <Pencil aria-hidden className="size-4" />
            Edit listing
          </ButtonLink>
        )}
        <ButtonLink href={listing.slug && !suspended ? publicListingHref(listing.slug) : "/marketplace-listing/preview"} size="lg">
          <SquareArrowOutUpRight aria-hidden className="size-4" />
          {suspended ? "Preview listing" : "View public profile"}
        </ButtonLink>
      </>
    ) : status === "hidden" ? (
      canManage && (
        <>
          <ButtonLink href="/marketplace-listing/edit" variant="secondary" size="lg">
            <Pencil aria-hidden className="size-4" />
            Edit listing
          </ButtonLink>
          <Button size="lg" onClick={publish}>
            <Rocket aria-hidden className="size-4" />
            Publish listing
          </Button>
        </>
      )
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Marketplace Listing</h1>
            <StatusBadge tone={suspended ? "danger" : STATUS_TONE[status]}>{suspended ? "Suspended by Climvia" : LISTING_STATUS_LABEL[status]}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Control how your business appears in Climvia&apos;s public Marketplace, where homeowners search for HVAC help.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>

      {suspended && <SuspendedNotice published={status === "published"} />}

      {configured && (
        <section aria-label="Listing summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Listing status"
            value={suspended ? "Suspended" : configured ? LISTING_STATUS_LABEL[status] : "Not configured"}
            icon={suspended ? ShieldAlert : status === "published" ? BadgeCheck : EyeOff}
            hint={suspended ? "Not discoverable: suspended by Climvia" : status === "published" ? "Visible in Climvia Marketplace" : status === "hidden" ? "Not discoverable in directory" : "Listing has not been set up"}
            hintDot={status === "published" && !suspended}
          />
          <KpiCard
            label="Public services"
            value={configured ? shown.length : "Not selected"}
            icon={Wrench}
            hint={
              !configured
                ? "No services selected"
                : `${shown.length} of ${eligible.length} eligible Services ${status === "published" ? "shown" : "configured"}`
            }
          />
          <KpiCard
            label="Contact details"
            value={!configured ? "Not configured" : isAnyContactShown(config) ? "Shown" : "Not shown"}
            icon={Phone}
            hint={!configured ? "Public details hidden" : isAnyContactShown(config) ? "Public contact information enabled" : "Contact details are off"}
          />
          <KpiCard
            label="Booking"
            value={!configured ? "Not configured" : config.actions.book ? "Enabled" : "Not shown"}
            icon={CalendarCheck}
            hint={!configured ? "Booking link unassigned" : config.actions.book ? "Customers can book from your listing" : 'The "Book service" button is off'}
          />
          <KpiCard
            label="Marketplace bookings"
            value={marketplaceBookings}
            icon={Store}
            hint={marketplaceBookings === 0 ? "None yet from your listing" : "Booked from your Marketplace listing"}
          />
        </section>
      )}

      {status === "not-set-up" ? (
        <>
          <EmptyState
            icon={Store}
            title="Set up your Marketplace listing"
            description="Choose which of your Services homeowners can book, where you work and which contact details they see. Nothing is public until you publish."
            action={
              canManage ? (
                <ButtonLink href="/marketplace-listing/edit?setup=1" size="lg">
                  <Plus aria-hidden className="size-4" />
                  Set up listing
                </ButtonLink>
              ) : undefined
            }
          />
          <div className="flex items-start gap-3 rounded-card bg-surface-low p-4">
            <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm text-ink-muted">
              Your Marketplace listing can use existing Business information and public Services. You choose what customers see.
            </p>
          </div>
        </>
      ) : (
        <>
          {status === "hidden" && (
            <section aria-labelledby="hidden-heading" className={cardClasses("lg", "flex flex-col gap-4 md:flex-row md:items-center md:justify-between")}>
              <div className="flex items-start gap-3">
                <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                <div>
                  <h2 id="hidden-heading" className="text-base font-semibold text-ink">
                    Your Marketplace listing is hidden
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    Publish your business listing when you&apos;re ready for customers to find it in the Climvia Marketplace.
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                    <Info aria-hidden className="size-3.5" />
                    Your listing content remains saved while the listing is hidden.
                  </p>
                </div>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <SectionCard
                title="Directory preview"
                description={status === "published" ? "Live preview of your public listing" : "Listing currently hidden · what customers will see once published"}
              >
                <div inert>
                  <ListingView data={data} variant="card" />
                </div>
              </SectionCard>
            </div>

            <div className="space-y-6 xl:col-span-4">
              <SectionCard
                title="Business information"
                icon={Store}
                action={
                  <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-primary hover:underline">
                    Edit in Settings
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                }
              >
                <p className="mb-3 text-xs text-ink-muted">Information shown here is connected to your primary Business Settings.</p>
                <KeyValueList
                  items={[
                    { label: "Business name", value: business.name },
                    { label: "Phone", value: business.phone },
                    { label: "Email", value: business.email },
                    { label: "Address", value: `${business.address.street}, ${formatCityStateZip(business.address)}` },
                    { label: "Website", value: data.website ?? "Not set up yet" },
                  ]}
                />
              </SectionCard>

              <SectionCard
                title="Service areas"
                icon={MapPin}
                action={
                  canManage ? (
                    <Link href="/marketplace-listing/edit" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      Edit areas
                      <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  ) : undefined
                }
              >
                {config.areas.length === 0 ? (
                  <p className="text-sm text-ink-muted">No service areas listed. Customers who search by place won&apos;t find this listing.</p>
                ) : (
                  <ul aria-label="Service areas" className="space-y-1.5 text-sm text-ink">
                    {config.areas.map((area) => (
                      <li key={`${area.city ?? ""}|${area.state ?? ""}|${area.postal ?? ""}`} className="flex items-center gap-2">
                        <MapPin aria-hidden className="size-3.5 shrink-0 text-primary" />
                        {areaDisplay(area)}
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                title="Services shown"
                action={
                  <Link href="/services" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Manage Services
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                }
              >
                <KeyValueList
                  items={[
                    { label: "Publicly visible offerings", value: `${shown.length} ${shown.length === 1 ? "service" : "services"}` },
                    { label: "Not displayed", value: `${notSelected.length} ${notSelected.length === 1 ? "service" : "services"} not selected` },
                  ]}
                />
                {notSelected.length > 0 && (
                  <ul className="mt-3 space-y-1.5 rounded-btn bg-surface-low p-3 text-xs text-ink-muted">
                    {notSelected.map((service) => (
                      <li key={service.id} className="flex items-start gap-2">
                        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium text-ink">{service.name}</span> — Not selected for the directory.
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
