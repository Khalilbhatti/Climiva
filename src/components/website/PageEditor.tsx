"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Eye, EyeOff, Monitor, RotateCcw, Rocket, Save, Smartphone } from "lucide-react";
import { useBrandStyle } from "@/components/settings/SettingsProvider";
import { useServices } from "@/components/services/ServicesProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { BOOKING_METHOD_LABEL, formatServicePrice } from "@/data/services";
import {
  findPage,
  getPageStatus,
  getPrimaryDomain,
  getShownServices,
  hasUnpublishedChanges,
  orderedSections,
  pagePath,
  type PageModel,
  type SectionModel,
  type ServiceDisplay,
} from "@/data/website";
import { cn } from "@/lib/cn";
import { SECTION_REGISTRY, connectedOf, fieldLabel, fieldsOf, type ConnectedSource } from "@/lib/site-sections";
import { accentStyle } from "@/lib/site-theme";
import { PREVIEW_BASE, previewHref } from "./site-links";
import { SiteFooter, SiteHeader, SiteRenderer } from "./SiteRenderer";
import { BrowserFrame, PageStatusBadge } from "./site-ui";
import { useSiteView, useWebsite, useWebsiteState } from "./WebsiteProvider";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CONNECTED_COPY: Record<ConnectedSource, { text: string; link: string; href: "/settings" | "/settings/hours" | "/services" }> = {
  services: { text: "Services come directly from your Service catalog. Their name, price, duration and booking method are managed there.", link: "Manage Services", href: "/services" },
  "business-info": { text: "Shown from your business information, so there is nothing to retype here.", link: "Business information", href: "/settings" },
  "business-hours": { text: "Shown from your business hours, so there is nothing to retype here.", link: "Business hours", href: "/settings/hours" },
  booking: { text: "Each Service sets how customers book it: instantly, by appointment request, or by quote request.", link: "Manage Services", href: "/services" },
};

function ServiceDisplayControls({ value, onChange }: { value: ServiceDisplay; onChange: (next: ServiceDisplay) => void }) {
  const { services: catalog } = useServices();
  const ordered = getShownServices({ order: value.order, hidden: [] }, catalog);

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

/** What a section holds while it is being edited: whether it is shown, and its text. Saved to the Draft by Save changes. */
type Working = Record<string, { visible: boolean; props: Record<string, string> }>;

const workingOf = (page: PageModel): Working => Object.fromEntries(page.sections.map((section) => [section.key, { visible: section.visible, props: { ...section.props } }]));

export function PageEditor({ pageKey }: { pageKey: string }) {
  const website = useWebsiteState();
  const { savePage, publish } = useWebsite();
  const canManage = useCan("website:manage");
  const brandStyle = useBrandStyle();
  const { toast } = useToast();

  const saved = findPage(website.draft, pageKey);
  const savedSections = saved ? orderedSections(saved) : [];
  const savedServices = website.draft.settings.serviceDisplay;
  const [working, setWorking] = useState<Working>(() => (saved ? workingOf(saved) : {}));
  const [servicesWorking, setServicesWorking] = useState<ServiceDisplay>(savedServices);
  const [activeId, setActiveId] = useState(savedSections[0]?.key ?? "");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);

  const editsServices = saved?.type === "services";
  const dirty =
    saved !== undefined && (savedSections.some((section) => !same(working[section.key], { visible: section.visible, props: section.props })) || (editsServices && !same(servicesWorking, savedServices)));
  const active = savedSections.find((section) => section.key === activeId) ?? savedSections[0];

  // The page as it would be if the edits were saved: what the canvas draws.
  const canvasPage: PageModel | undefined = saved && {
    ...saved,
    sections: saved.sections.map((section) => ({ ...section, visible: working[section.key]?.visible ?? section.visible, props: working[section.key]?.props ?? section.props })),
  };
  const canvasVersion = { ...website.draft, settings: { ...website.draft.settings, serviceDisplay: editsServices ? servicesWorking : savedServices } };
  const view = useSiteView(canvasVersion, PREVIEW_BASE);

  const errorOf = (section: SectionModel, key: string) => ((working[section.key]?.props[key] ?? "").trim() === "" ? "This field can't be empty." : undefined);
  const hasErrors = savedSections.some((section) => fieldsOf(section.type, section.variant).some((field) => field.kind !== "align" && errorOf(section, field.key)));

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

  if (!saved || !canvasPage || !active) return null;

  function setValue(sectionKey: string, key: string, value: string) {
    setWorking((current) => ({ ...current, [sectionKey]: { ...current[sectionKey], props: { ...current[sectionKey].props, [key]: value } } }));
    setServerErrors({});
  }

  async function save() {
    if (saving || !saved) return;
    setSaving(true);
    const changed = savedSections.filter((section) => !same(working[section.key], { visible: section.visible, props: section.props }));
    const result = await savePage(pageKey, {
      sections: Object.fromEntries(changed.map((section) => [section.key, working[section.key]])),
      serviceDisplay: editsServices && !same(servicesWorking, savedServices) ? servicesWorking : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setServerErrors(result.fields ?? {});
      toast(result.error);
      return;
    }
    setServerErrors({});
    toast(website.published ? `${saved.title} page saved. Publish to make it live.` : `${saved.title} page saved.`);
  }

  function discard() {
    if (!saved) return;
    setWorking(workingOf(saved));
    setServicesWorking(savedServices);
    setServerErrors({});
    setDiscarding(false);
    toast("Unsaved changes discarded.");
  }

  async function publishNow() {
    const result = await publish();
    toast(result.ok ? "Website published." : result.error);
  }

  const status = getPageStatus(website, pageKey);
  const nothingToPublish = website.published && !hasUnpublishedChanges(website);
  const sectionDirty = (section: SectionModel) =>
    !same(working[section.key], { visible: section.visible, props: section.props }) || (editsServices && section.type === "service_list" && section.variant === "catalog" && !same(servicesWorking, savedServices));
  const activeContent = working[active.key] ?? { visible: active.visible, props: active.props };
  const activeDef = SECTION_REGISTRY[active.type];
  const activeConnected = connectedOf(active.type, active.variant);
  const address = getPrimaryDomain(website.site, website.domain);

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
              {saved.title}
            </li>
          </ol>
        </nav>
        <div className="mt-2 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">Edit {saved.title} page</h1>
              {dirty ? <StatusBadge tone="warning">Unsaved changes</StatusBadge> : <PageStatusBadge status={status} />}
            </div>
            <p className="mt-1 font-mono text-xs text-ink-muted">
              {address}
              {pagePath(saved)}
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
              <ButtonLink href={previewHref(saved.slug)} variant="secondary">
                <Eye aria-hidden className="size-4" />
                Preview
              </ButtonLink>
            )}
            {canManage && (
              <>
                <Button onClick={save} disabled={!dirty || hasErrors || saving}>
                  <Save aria-hidden className="size-4" />
                  Save changes
                </Button>
                <Button variant={dirty || nothingToPublish ? "secondary" : "primary"} disabled={dirty || nothingToPublish} onClick={publishNow}>
                  <Rocket aria-hidden className="size-4" />
                  {website.published ? "Publish changes" : "Publish website"}
                </Button>
              </>
            )}
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
            <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">{savedSections.length}</span>
          </div>
          <ul className="space-y-1.5">
            {savedSections.map((section) => {
              const visible = working[section.key]?.visible !== false;
              const connected = connectedOf(section.type, section.variant);
              return (
                <li key={section.key}>
                  <button
                    type="button"
                    onClick={() => setActiveId(section.key)}
                    aria-current={section.key === active.key ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left transition-colors",
                      section.key === active.key ? "bg-primary-subtle" : "hover:bg-surface-low",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{section.label}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {connected ? "Connected · " : ""}
                        {sectionDirty(section) ? "Edited · Unsaved" : SECTION_REGISTRY[section.type].summary}
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
          <BrowserFrame address={`https://${address}${pagePath(saved)}`} note={device === "mobile" ? "Mobile" : "Desktop"}>
            <div ref={scroller} className="relative max-h-[40rem] overflow-y-auto bg-surface-low">
              <div
                inert
                style={{ ...brandStyle, ...accentStyle(website.draft.theme) }}
                className={cn("@container mx-auto bg-surface", device === "mobile" ? "max-w-[390px] border-x border-line" : "w-full")}
              >
                <SiteHeader view={view} />
                <SiteRenderer page={canvasPage} view={view} activeSection={active.key} embedded />
                <SiteFooter view={view} />
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
              <p className="mt-0.5 text-xs text-ink-muted">{activeDef.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Visible</span>
              <Switch
                checked={activeContent.visible}
                label={`Show ${active.label} section`}
                disabled={!canManage}
                onChange={(visible) => setWorking((current) => ({ ...current, [active.key]: { ...current[active.key], visible } }))}
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {activeConnected && (
              <div className="rounded-btn bg-surface-low p-3">
                <p className="text-xs text-ink-muted">{CONNECTED_COPY[activeConnected].text}</p>
                <Link href={CONNECTED_COPY[activeConnected].href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  {CONNECTED_COPY[activeConnected].link}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            )}

            {active.type === "service_list" && active.variant !== "booking" &&
              (editsServices ? (
                <ServiceDisplayControls value={servicesWorking} onChange={setServicesWorking} />
              ) : (
                <p className="text-xs text-ink-muted">
                  Which Services appear on the website is set on the{" "}
                  <Link href="/website/pages/services" className="font-semibold text-primary hover:underline">
                    Services page
                  </Link>
                  .
                </p>
              ))}

            {fieldsOf(active.type, active.variant).map((field) => {
              const value = activeContent.props[field.key] ?? "";
              const label = fieldLabel(active.type, active.variant, field);
              if (field.kind === "align") {
                return (
                  <fieldset key={`${active.key}-${field.key}`}>
                    <legend className="mb-1 text-xs font-medium text-ink">{label}</legend>
                    <div className="flex rounded-btn bg-surface-low p-1">
                      {(["left", "center"] as const).map((option) => (
                        <label
                          key={option}
                          className="flex-1 cursor-pointer rounded px-3 py-1.5 text-center text-xs font-semibold text-ink-muted capitalize has-checked:bg-surface has-checked:text-primary has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-primary"
                        >
                          <input
                            type="radio"
                            name={`${active.key}-alignment`}
                            className="sr-only"
                            disabled={!canManage}
                            checked={value === option}
                            onChange={() => setValue(active.key, field.key, option)}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              }
              const common = {
                label,
                value,
                disabled: !canManage,
                maxLength: field.max,
                error: errorOf(active, field.key) ?? serverErrors[`${active.key}.${field.key}`],
                hint: `${value.length} / ${field.max}`,
                onChange: (event: { target: { value: string } }) => setValue(active.key, field.key, event.target.value),
              };
              return field.kind === "textarea" ? (
                <Textarea key={`${active.key}-${field.key}`} rows={4} {...common} />
              ) : (
                <Input key={`${active.key}-${field.key}`} {...common} />
              );
            })}
            {!canManage && <p className="text-xs text-ink-muted">You can look at this page. Only an owner or admin can change it.</p>}
            {canManage && fieldsOf(active.type, active.variant).some((field) => field.kind !== "align") && (
              <p className="text-xs text-ink-muted">
                Use {"{{business.name}}"} and {"{{business.location}}"} to insert your business name and place, so the text follows them.
              </p>
            )}
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
        description={`Your unsaved edits to the ${saved.title} page will be lost. Saved content and the published website are not affected.`}
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
