"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUp, EyeOff, Info, Lock, RotateCcw, Rocket, Save } from "lucide-react";
import { useBusiness, useHoursRows } from "@/components/settings/SettingsProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedGuard } from "@/components/ui/UnsavedGuard";
import { formatCityStateZip } from "@/lib/format";
import {
  CONTACT_FIELDS,
  COVERS,
  DESCRIPTION_MAX,
  LISTING_ACTIONS,
  LISTING_STATUS_LABEL,
  getEligibleServices,
  getOrderedEligibleServices,
  isServiceSelected,
  sameConfig,
  type ContactField,
  type CoverId,
  type ListingConfig,
} from "@/data/marketplace";
import { BOOKING_METHOD_ACTION, formatServicePrice } from "@/data/services";
import { moveService, toggleService } from "@/lib/marketplace-state";
import { ListingView } from "./ListingView";
import { useListingData } from "./listing-data";
import { useMarketplace } from "./MarketplaceProvider";
import { ServiceAreaEditor } from "./ServiceAreaEditor";
import { SuspendedNotice } from "./SuspendedNotice";
import { useServices } from "@/components/services/ServicesProvider";

const NO_COVER = "none";

/** Edit Marketplace listing, and (with ?setup=1) the first-time setup. One form, one set of fields. */
export function ListingEditor() {
  const { listing, saveListing, publishListing, hideListing, setUpListing } = useMarketplace();
  const business = useBusiness();
  const hours = useHoursRows();
  const { toast } = useToast();
  const router = useRouter();
  const setup = useSearchParams().get("setup") === "1" || listing.status === "not-set-up";

  const saved = listing.config;
  const [working, setWorking] = useState<ListingConfig>(saved);
  const [hiding, setHiding] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = !sameConfig(working, saved);
  const { guard } = useUnsavedGuard(dirty, "your edits to this listing");

  // The picture of the listing as it would be if the edits were saved.
  const preview = useListingData(working);
  const domain = preview.website ?? "Not set up yet";
  const { services: catalog } = useServices();
  const eligible = getEligibleServices(catalog);
  const ordered = getOrderedEligibleServices(working, catalog);
  const descriptionError = working.description.trim() === "" ? "Enter a description for your listing." : undefined;
  const servicesError = working.selected.length === 0 ? "Select at least one Service to show." : undefined;
  const invalid = Boolean(descriptionError || servicesError);
  const published = listing.status === "published";

  const patch = (change: Partial<ListingConfig>) => setWorking((current) => ({ ...current, ...change }));
  const setContact = (field: ContactField, on: boolean) => setWorking((current) => ({ ...current, contact: { ...current.contact, [field]: on } }));

  const contactValue: Record<ContactField, string> = {
    phone: business.phone,
    email: business.email,
    address: `${business.address.street}, ${formatCityStateZip(business.address)}`,
    hours: hours.map((row) => `${row.days} ${row.hours}`).join(" · "),
    website: domain,
  };

  async function save() {
    if (invalid) return setShowErrors(true);
    if (busy) return;
    setBusy(true);
    const result = await saveListing(working);
    setBusy(false);
    // What is stored is what the screen shows from now on (the order of an unselected Service is not kept, for one).
    if (result.ok) setWorking(result.data.marketplace.config);
    toast(result.ok ? "Listing changes saved." : result.error);
  }

  async function saveAndPublish() {
    if (invalid) return setShowErrors(true);
    if (busy) return;
    setBusy(true);
    const result = await setUpListing(working);
    setBusy(false);
    if (!result.ok) return toast(result.error);
    toast("Marketplace listing published.");
    router.push("/marketplace-listing");
  }

  async function publish() {
    const result = await publishListing();
    toast(result.ok ? "Marketplace listing published." : result.error);
  }

  async function confirmHide() {
    const result = await hideListing();
    setHiding(false);
    toast(result.ok ? "Marketplace listing hidden. Your listing content is saved." : result.error);
  }

  return (
    <div className="space-y-6">
      <div>
        <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/marketplace-listing" className="hover:text-primary">
                Marketplace
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="font-medium text-ink">
              {setup ? "Set up listing" : "Edit listing"}
            </li>
          </ol>
        </nav>
        <div className="mt-2 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">{setup ? "Set up Marketplace listing" : "Edit Marketplace listing"}</h1>
              {setup ? (
                <StatusBadge tone="neutral">Draft</StatusBadge>
              ) : (
                <StatusBadge tone={published ? "positive" : "neutral"}>{LISTING_STATUS_LABEL[listing.status]}</StatusBadge>
              )}
              {dirty && <StatusBadge tone="warning">Unsaved changes</StatusBadge>}
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {setup ? "Review what customers will see before publishing your listing." : "Choose what customers see on your public Climvia listing."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {setup ? (
              <>
                <ButtonLink href="/marketplace-listing" variant="secondary">
                  Back to Marketplace
                </ButtonLink>
                <Button onClick={saveAndPublish} disabled={busy}>
                  <Rocket aria-hidden className="size-4" />
                  Save &amp; publish listing
                </Button>
              </>
            ) : (
              <>
                {dirty && (
                  <Button variant="tertiary" onClick={() => setDiscarding(true)}>
                    <RotateCcw aria-hidden className="size-4" />
                    Discard
                  </Button>
                )}
                {dirty || !published ? (
                  <>
                    <Button variant="secondary" disabled aria-describedby="preview-unavailable">
                      Preview listing
                    </Button>
                    <span id="preview-unavailable" className="sr-only">
                      {dirty ? "Save your changes to preview the listing." : "Publish the listing to preview it."}
                    </span>
                  </>
                ) : (
                  <ButtonLink href="/marketplace-listing/preview" variant="secondary">
                    Preview listing
                  </ButtonLink>
                )}
                {published ? (
                  <Button variant="secondary" onClick={() => setHiding(true)}>
                    <EyeOff aria-hidden className="size-4" />
                    Hide listing
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={publish}>
                    <Rocket aria-hidden className="size-4" />
                    Publish listing
                  </Button>
                )}
                <Button onClick={save} disabled={!dirty || busy}>
                  <Save aria-hidden className="size-4" />
                  Save changes
                </Button>
              </>
            )}
          </div>
        </div>
        {listing.suspended && (
          <div className="mt-3">
            <SuspendedNotice published={published} />
          </div>
        )}
        {setup && (
          <p className="mt-3 flex items-start gap-2 rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Your Marketplace listing can use existing Business information and public Services. You choose what customers see. Nothing is publicly
            discoverable until you click Save &amp; publish listing.
          </p>
        )}
        {dirty && !setup && (
          <p role="status" className="mt-3 rounded-btn bg-warning-soft px-3 py-2 text-xs text-warning">
            You have unsaved changes to your Marketplace listing. Changes are previewed on the right. Save them to preview the public listing.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-6">
          <SectionCard title="Listing details" description="Marketplace-specific information that helps customers understand your business.">
            <div className="space-y-5">
              <div>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-ink">Business name</span>
                  <span className="text-ink-muted">From Business Settings</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-btn border border-line bg-surface-low px-3 py-2 text-sm text-ink-muted">
                  <span>{business.name}</span>
                  <Lock aria-label="Managed in Business Settings" className="size-4" />
                </div>
                <Link href="/settings" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  Edit business information
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>

              <Textarea
                label="Business description"
                required
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={working.description}
                error={showErrors ? descriptionError : undefined}
                hint={`${working.description.length} / ${DESCRIPTION_MAX} · Shown on your public Marketplace listing.`}
                onChange={(event) => patch({ description: event.target.value })}
              />

              <OptionGroup legend="Cover image" hint="Choose a cover for the top of your listing, or leave it off." className="sm:grid-cols-2">
                {COVERS.map((cover) => (
                  <OptionCard
                    key={cover.id}
                    type="radio"
                    name="cover"
                    title={cover.label}
                    description={cover.description}
                    checked={working.cover === cover.id}
                    onChange={() => patch({ cover: cover.id as CoverId })}
                  />
                ))}
                <OptionCard
                  type="radio"
                  name="cover"
                  value={NO_COVER}
                  title="No cover image"
                  description="Start the listing with your business name"
                  checked={working.cover === undefined}
                  onChange={() => patch({ cover: undefined })}
                />
              </OptionGroup>
            </div>
          </SectionCard>

          <SectionCard
            title="Contact information"
            description="Choose which configured business details customers can see. All values come from Business Settings."
          >
            <ul className="divide-y divide-line">
              {CONTACT_FIELDS.map((field) => (
                <li key={field.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{field.label}</p>
                    <p className="text-sm text-ink">{contactValue[field.id]}</p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                    {field.toggle}
                    <Switch checked={working.contact[field.id]} label={field.toggle} onChange={(on) => setContact(field.id, on)} />
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">
              Business information is managed in Business Settings.{" "}
              <Link href="/settings" className="font-semibold text-primary hover:underline">
                Edit business information
              </Link>
            </p>
          </SectionCard>

          <SectionCard
            title="Services shown"
            description={`${working.selected.length} of ${eligible.length} eligible Services selected. Choose which Services appear and in what order.`}
          >
            <ul className="space-y-2">
              {ordered.map((service, index) => {
                const on = isServiceSelected(working, service.id);
                return (
                  <li key={service.id} className="flex items-center gap-3 rounded-btn bg-surface-low px-3 py-2.5">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={on}
                        onChange={(event) => setWorking((current) => toggleService(current, service.id, event.target.checked))}
                        aria-label={`Show ${service.name}`}
                      />
                      <span className="min-w-0">
                        <span className={on ? "block text-sm font-medium text-ink" : "block text-sm font-medium text-ink-muted"}>{service.name}</span>
                        <span className="block text-xs text-ink-muted">
                          {formatServicePrice(service.pricing)} · {BOOKING_METHOD_ACTION[service.bookingMethod]}
                        </span>
                      </span>
                    </label>
                    <span className="hidden shrink-0 text-xs font-medium text-ink-muted sm:inline">{on ? "Shown" : "Not selected"}</span>
                    <button
                      type="button"
                      onClick={() => setWorking((current) => moveService(current, service.id, -1))}
                      disabled={index === 0}
                      aria-label={`Move ${service.name} up`}
                      className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorking((current) => moveService(current, service.id, 1))}
                      disabled={index === ordered.length - 1}
                      aria-label={`Move ${service.name} down`}
                      className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {showErrors && servicesError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {servicesError}
              </p>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Service details are managed in Services. Internal-only and inactive Services are not available for Marketplace display.{" "}
              <Link href="/services" className="font-semibold text-primary hover:underline">
                Manage Services
              </Link>
            </p>
          </SectionCard>

          <SectionCard
            title="Service areas"
            description="Where you work. Customers who search by city or ZIP code find your listing only for the places listed here."
          >
            <ServiceAreaEditor areas={working.areas} onChange={(areas) => patch({ areas })} />
          </SectionCard>

          <SectionCard title="Customer actions" description="Choose which actions are available from your Marketplace listing.">
            <ul className="divide-y divide-line">
              {LISTING_ACTIONS.map((action) => (
                <li key={action.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{action.toggle}</p>
                    <p className="text-xs text-ink-muted">{action.detail}</p>
                  </div>
                  <Switch
                    checked={working.actions[action.id]}
                    label={action.toggle}
                    onChange={(on) => setWorking((current) => ({ ...current, actions: { ...current.actions, [action.id]: on } }))}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">
              Booking from your listing opens a booking page for the Service on Climvia Marketplace, and the booking arrives in your Bookings marked as a Marketplace booking. Website and contact actions lead to your website. Marketplace does not create Jobs, Quotes, or Invoices directly.
            </p>
          </SectionCard>

          {!setup && (
            <section aria-labelledby="visibility-heading" className={cardClasses("lg", "flex items-center justify-between gap-4")}>
              <div>
                <h2 id="visibility-heading" className="text-base font-semibold text-ink">
                  Listing visibility
                </h2>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {published
                    ? "When visible, customers can discover your business in the Climvia Marketplace."
                    : "Your business listing is currently hidden from the Climvia Marketplace. Your listing content remains saved."}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm font-medium text-ink">
                Listing visible
                <Switch
                  checked={published}
                  label="Listing visible"
                  onChange={(on) => {
                    if (on) void publish();
                    else setHiding(true);
                  }}
                />
              </label>
            </section>
          )}
        </div>

        <aside aria-label="Listing preview" className="xl:sticky xl:top-24 xl:self-start">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-ink">Listing preview</span>
            <span className="text-ink-muted">{dirty ? "Live preview (unsaved)" : "Live preview"}</span>
          </div>
          <div inert>
            <ListingView data={preview} variant="card" />
          </div>
        </aside>
      </div>

      <Modal
        open={hiding}
        onClose={() => setHiding(false)}
        title="Hide Marketplace listing?"
        description="Customers will no longer be able to discover your business in the Climvia Marketplace. Your listing content and configuration will remain saved."
        footer={
          <>
            <Button variant="secondary" onClick={() => setHiding(false)}>
              Cancel
            </Button>
            <Button variant="destructive-solid" onClick={confirmHide}>
              Hide listing
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 rounded-card bg-surface-low p-3 text-sm text-ink-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          You can publish the listing again at any time. Your business information and Services are not changed.
        </p>
      </Modal>

      <Modal
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Discard unsaved changes?"
        description="Your unsaved edits to this listing will be lost. The saved listing is not affected."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive-solid"
              onClick={() => {
                setWorking(saved);
                setDiscarding(false);
                setShowErrors(false);
                toast("Unsaved changes discarded.");
              }}
            >
              Discard changes
            </Button>
          </>
        }
      />
      {guard}
    </div>
  );
}
