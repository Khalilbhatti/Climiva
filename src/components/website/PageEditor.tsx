"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Eye, EyeOff, Monitor, RotateCcw, Rocket, Save, Smartphone } from "lucide-react";
import { useBrandStyle } from "@/components/settings/SettingsProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatServicePrice, getPublicActiveServices, BOOKING_METHOD_LABEL } from "@/data/services";
import {
  PAGE_SCHEMA,
  getPageStatus,
  getPrimaryDomain,
  getShownServices,
  getWebsitePage,
  type ConnectedSource,
  type PageContent,
  type PageId,
  type SectionDef,
  type ServiceDisplay,
  type SiteContent,
} from "@/data/website";
import { cn } from "@/lib/cn";
import { previewHref } from "./site-links";
import { SiteFooter, SiteHeader, SiteRenderer } from "./SiteRenderer";
import { BrowserFrame, PageStatusBadge } from "./site-ui";
import { useWebsite } from "./WebsiteProvider";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CONNECTED_COPY: Record<ConnectedSource, { text: string; link: string; href: "/settings" | "/settings/hours" | "/services" }> = {
  services: { text: "Services come directly from your Service catalog. Their name, price, duration and booking method are managed there.", link: "Manage Services", href: "/services" },
  "business-info": { text: "Shown from your business information, so there is nothing to retype here.", link: "Business information", href: "/settings" },
  "business-hours": { text: "Shown from your business hours, so there is nothing to retype here.", link: "Business hours", href: "/settings/hours" },
  booking: { text: "Each Service sets how customers book it: instantly, by appointment request, or by quote request.", link: "Manage Services", href: "/services" },
};

function ServiceDisplayControls({ value, onChange }: { value: ServiceDisplay; onChange: (next: ServiceDisplay) => void }) {
  const ordered = getShownServices({ order: value.order, hidden: [] }, getPublicActiveServices());

  function move(id: string, by: -1 | 1) {
    const ids = ordered.map((service) => service.id);
    const index = ids.indexOf(id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onChange({ ...value, order: ids });
  }

  return (
    <div>
      <p className="mb-3 text-xs text-ink-muted">
        Choose which Services the website shows and in what order. Names, prices and booking methods always come from the Service catalog.
      </p>
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
                disabled={index === 0}
                aria-label={`Move ${service.name} up`}
                className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
              >
                <ArrowUp aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => move(service.id, 1)}
                disabled={index === ordered.length - 1}
                aria-label={`Move ${service.name} down`}
                className="rounded-btn p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30"
              >
                <ArrowDown aria-hidden className="size-4" />
              </button>
              <Switch
                checked={shown}
                label={`Show ${service.name} on the website`}
                onChange={(next) =>
                  onChange({ ...value, hidden: next ? value.hidden.filter((id) => id !== service.id) : [...value.hidden, service.id] })
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PageEditor({ pageId }: { pageId: PageId }) {
  const { site, savePage, publish } = useWebsite();
  const brandStyle = useBrandStyle();
  const { toast } = useToast();
  const page = getWebsitePage(pageId);
  const schema = PAGE_SCHEMA[pageId];

  const saved: PageContent = site.draft.pages[pageId];
  const savedServices = site.draft.services;
  const [working, setWorking] = useState<PageContent>(saved);
  const [servicesWorking, setServicesWorking] = useState<ServiceDisplay>(savedServices);
  const [activeId, setActiveId] = useState(schema[0].id);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [discarding, setDiscarding] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);

  const editsServices = pageId === "services";
  const dirty = !same(working, saved) || (editsServices && !same(servicesWorking, savedServices));
  const active = schema.find((section) => section.id === activeId) ?? schema[0];

  const errorOf = (section: SectionDef, key: string) =>
    (working[section.id]?.values[key] ?? "").trim() === "" ? "This field can't be empty." : undefined;
  const hasErrors = schema.some((section) => section.fields.some((field) => field.kind !== "align" && errorOf(section, field.key)));

  const canvas: SiteContent = {
    pages: { ...site.draft.pages, [pageId]: working },
    services: editsServices ? servicesWorking : savedServices,
  };

  // Bring the selected section into view in the canvas.
  useEffect(() => {
    // Leave the canvas at the top when the editor first opens.
    if (firstScroll.current) {
      firstScroll.current = false;
      return;
    }
    const box = scroller.current;
    const target = box?.querySelector<HTMLElement>(`[data-section="${activeId}"]`);
    if (box && target) box.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: "auto" });
  }, [activeId]);

  if (!page) return null;

  function setValue(sectionId: string, key: string, value: string) {
    setWorking((current) => ({
      ...current,
      [sectionId]: { ...current[sectionId], values: { ...current[sectionId].values, [key]: value } },
    }));
  }

  function save() {
    savePage(pageId, working, editsServices ? servicesWorking : undefined);
    toast(site.published ? `${page!.title} page saved. Publish to make it live.` : `${page!.title} page saved.`);
  }

  function discard() {
    setWorking(saved);
    setServicesWorking(savedServices);
    setDiscarding(false);
    toast("Unsaved changes discarded.");
  }

  const status = getPageStatus(site, pageId);
  const nothingToPublish = site.published && status === "published" && same(site.draft, site.live);
  const sectionDirty = (section: SectionDef) =>
    !same(working[section.id], saved[section.id]) || (editsServices && section.id === "catalog" && !same(servicesWorking, savedServices));
  const activeContent = working[active.id];

  return (
    <div className="space-y-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/website" className="hover:text-primary">
                Website
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/website/pages" className="hover:text-primary">
                Pages &amp; content
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="font-medium text-ink">
              {page.title}
            </li>
          </ol>
        </nav>
        <div className="mt-2 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">Edit {page.title} page</h1>
              {dirty ? <StatusBadge tone="warning">Unsaved changes</StatusBadge> : <PageStatusBadge status={status} />}
            </div>
            <p className="mt-1 font-mono text-xs text-ink-muted">
              {getPrimaryDomain(site.domain)}
              {page.path}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Preview size" className="flex rounded-btn bg-surface-low p-1">
              {(
                [
                  { id: "desktop", label: "Desktop", icon: Monitor },
                  { id: "mobile", label: "Mobile", icon: Smartphone },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={device === option.id}
                  onClick={() => setDevice(option.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                    device === option.id ? "bg-surface text-primary shadow-card" : "text-ink-muted hover:text-ink",
                  )}
                >
                  <option.icon aria-hidden className="size-3.5" />
                  {option.label}
                </button>
              ))}
            </div>
            {dirty ? (
              <>
                <Button variant="secondary" disabled aria-describedby="preview-unavailable">
                  <Eye aria-hidden className="size-4" />
                  Preview
                </Button>
                <span id="preview-unavailable" className="sr-only">
                  Save your changes to preview this page.
                </span>
              </>
            ) : (
              <ButtonLink href={previewHref(pageId)} variant="secondary">
                <Eye aria-hidden className="size-4" />
                Preview
              </ButtonLink>
            )}
            <Button onClick={save} disabled={!dirty || hasErrors}>
              <Save aria-hidden className="size-4" />
              Save changes
            </Button>
            <Button
              variant={dirty || nothingToPublish ? "secondary" : "primary"}
              disabled={dirty || nothingToPublish}
              onClick={() => {
                publish();
                toast("Website published.");
              }}
            >
              <Rocket aria-hidden className="size-4" />
              {site.published ? "Publish changes" : "Publish website"}
            </Button>
          </div>
        </div>
        {dirty && (
          <p role="status" className="mt-3 rounded-btn bg-warning-soft px-3 py-2 text-xs text-warning">
            You have unsaved changes. Save them to preview the page or publish the website.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <section aria-labelledby="sections-heading" className={cn(cardClasses("md"), "xl:self-start")}>
          <div className="mb-3 flex items-center justify-between">
            <h2 id="sections-heading" className="text-sm font-semibold text-ink">
              Page sections
            </h2>
            <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">{schema.length}</span>
          </div>
          <ul className="space-y-1.5">
            {schema.map((section) => {
              const visible = working[section.id]?.visible !== false;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(section.id)}
                    aria-current={section.id === active.id ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left transition-colors",
                      section.id === active.id ? "bg-primary-subtle" : "hover:bg-surface-low",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{section.label}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {section.connected ? "Connected · " : ""}
                        {sectionDirty(section) ? "Edited · Unsaved" : section.summary}
                      </span>
                    </span>
                    {visible ? <Eye aria-hidden className="size-4 shrink-0 text-ink-muted" /> : <EyeOff aria-hidden className="size-4 shrink-0 text-ink-faint" />}
                    <span className="sr-only">{visible ? "Visible" : "Hidden"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 rounded-btn bg-surface-low px-3 py-2 text-xs text-ink-muted">
            Connected content stays in sync with your Services and business information. Each page has a fixed set of sections.
          </p>
        </section>

        <section aria-label="Page preview" className="min-w-0">
          <BrowserFrame address={`https://${getPrimaryDomain(site.domain)}${page.path}`} note={device === "mobile" ? "Mobile" : "Desktop"}>
            <div ref={scroller} className="relative max-h-[40rem] overflow-y-auto bg-surface-low">
              <div inert style={brandStyle} className={cn("@container mx-auto bg-surface", device === "mobile" ? "max-w-[390px] border-x border-line" : "w-full")}>
                <SiteHeader />
                <SiteRenderer page={pageId} content={canvas} activeSection={active.id} embedded />
                <SiteFooter />
              </div>
            </div>
          </BrowserFrame>
        </section>

        <section aria-labelledby="settings-heading" className={cn(cardClasses("md"), "xl:self-start")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="settings-heading" className="text-sm font-semibold text-ink">
                {active.label} settings
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">{active.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Visible</span>
              <Switch
                checked={activeContent.visible}
                label={`Show ${active.label} section`}
                onChange={(visible) => setWorking((current) => ({ ...current, [active.id]: { ...current[active.id], visible } }))}
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {active.connected && (
              <div className="rounded-btn bg-surface-low p-3">
                <p className="text-xs text-ink-muted">{CONNECTED_COPY[active.connected].text}</p>
                <Link href={CONNECTED_COPY[active.connected].href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  {CONNECTED_COPY[active.connected].link}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            )}

            {active.connected === "services" && (
              editsServices ? (
                <ServiceDisplayControls value={servicesWorking} onChange={setServicesWorking} />
              ) : (
                <p className="text-xs text-ink-muted">
                  Which Services appear on the website is set on the{" "}
                  <Link href="/website/pages/services" className="font-semibold text-primary hover:underline">
                    Services page
                  </Link>
                  .
                </p>
              )
            )}

            {active.fields.map((field) => {
              const value = activeContent.values[field.key] ?? "";
              if (field.kind === "align") {
                return (
                  <fieldset key={`${active.id}-${field.key}`}>
                    <legend className="mb-1 text-xs font-medium text-ink">{field.label}</legend>
                    <div className="flex rounded-btn bg-surface-low p-1">
                      {(["left", "center"] as const).map((option) => (
                        <label
                          key={option}
                          className="flex-1 cursor-pointer rounded px-3 py-1.5 text-center text-xs font-semibold text-ink-muted capitalize has-checked:bg-surface has-checked:text-primary has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-primary"
                        >
                          <input
                            type="radio"
                            name={`${active.id}-alignment`}
                            className="sr-only"
                            checked={value === option}
                            onChange={() => setValue(active.id, field.key, option)}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              }
              const common = {
                label: field.label,
                value,
                maxLength: field.max,
                error: errorOf(active, field.key),
                hint: `${value.length} / ${field.max}`,
                onChange: (event: { target: { value: string } }) => setValue(active.id, field.key, event.target.value),
              };
              return field.kind === "textarea" ? (
                <Textarea key={`${active.id}-${field.key}`} rows={4} {...common} />
              ) : (
                <Input key={`${active.id}-${field.key}`} {...common} />
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
            <Button variant="tertiary" size="sm" disabled={!dirty} onClick={() => setDiscarding(true)}>
              <RotateCcw aria-hidden className="size-3.5" />
              Discard edits
            </Button>
            <span className="text-xs text-ink-muted">{dirty ? "Not saved yet" : "All changes saved"}</span>
          </div>
        </section>
      </div>

      <Modal
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Discard unsaved changes?"
        description={`Your unsaved edits to the ${page.title} page will be lost. Saved content and the published website are not affected.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button variant="destructive-solid" onClick={discard}>
              Discard changes
            </Button>
          </>
        }
      />
    </div>
  );
}
