"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Copy, EllipsisVertical, Globe, Info, Link as LinkIcon, Plus, ShieldCheck, SquareArrowOutUpRight, Unlink } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { getPrimaryDomain, platformHost, primaryDomainOf, type DomainRecord } from "@/data/website";
import { ACTIVATION_NOTE, DOMAIN_STATUS_LABEL, OWNERSHIP_OUTCOME_TEXT, routingAdvice } from "@/lib/domain-rules";
import { HOSTNAME_PROBLEM_TEXT, normalizeHostname } from "@/lib/hostname";
import { publicSiteHref } from "@/lib/site-domain";
import { DOMAIN_TONE } from "./domain-ui";
import { previewHref } from "./site-links";
import { useWebsite, useWebsiteState } from "./WebsiteProvider";

/** A small menu opened from a ⋮ button: Esc or an outside click closes it, and focus returns to the button. */
function OverflowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={menuButton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="rounded-btn p-2 text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
      >
        <EllipsisVertical aria-hidden className="size-4" />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute right-0 z-10 mt-1 min-w-44 rounded-card border border-line bg-surface p-1 shadow-overlay">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function AddressRow({ host, tags, note, primary, actions }: { host: string; tags: ReactNode; note: string; primary: boolean; actions: ReactNode }) {
  return (
    <div className={`rounded-card border p-4 ${primary ? "border-primary/30 bg-primary-subtle/40" : "border-line bg-surface-low"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold break-all text-ink">{host}</span>
            {tags}
          </div>
          <p className="mt-1 text-xs text-ink-muted">{note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** One value to copy into a DNS provider: what it is, the value, a Copy button. */
function CopyField({ label, value, onCopy }: { label: string; value: string; onCopy: (label: string, value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-line bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="font-mono text-xs break-all text-ink">{value}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => onCopy(label, value)} aria-label={`Copy ${label}`}>
        <Copy aria-hidden className="size-3.5" />
        Copy
      </Button>
    </div>
  );
}

const STATE_NOTE: Record<DomainRecord["status"], string> = {
  pending_verification: "Climvia has not yet confirmed that you control this domain.",
  verified: "You control this domain. It is not serving your website yet.",
  active: "Climvia will show your website when a request for this domain arrives.",
  disabled: "Climvia no longer shows your website for this domain.",
  removed: "",
};

export function DomainManager() {
  const website = useWebsiteState();
  const { addDomain, verifyDomain, activateDomain, disableDomain, removeDomain, setMainDomain } = useWebsite();
  const canManage = useCan("website:manage");
  const { toast } = useToast();
  const [removing, setRemoving] = useState<DomainRecord>();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const { domains, routingTarget } = website.domain;
  const CLIMVIA_DOMAIN = platformHost(website.site.platformSlug);
  const view = website.published ? publicSiteHref(website.site.platformSlug) : previewHref();
  const mainCustom = primaryDomainOf(website.domain);

  async function run(call: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    if (busy) return false;
    setBusy(true);
    const result = await call();
    setBusy(false);
    toast(result.ok ? success : result.error);
    return result.ok;
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied to clipboard.`);
    } catch {
      toast(`Copy this: ${value}`);
    }
  }

  async function check(record: DomainRecord) {
    if (busy) return;
    setBusy(true);
    const result = await verifyDomain(record.id, record.revision);
    setBusy(false);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    const text = result.data.domainCheck ? OWNERSHIP_OUTCOME_TEXT[result.data.domainCheck] : null;
    toast(text ?? `Ownership of ${record.hostname} is verified.`);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const first = normalizeHostname(draft);
    if (!first.ok) {
      setError(HOSTNAME_PROBLEM_TEXT[first.problem]);
      return;
    }
    if (busy) return;
    setBusy(true);
    const result = await addDomain(first.hostname);
    setBusy(false);
    if (!result.ok) {
      setError(result.fields?.domain ?? result.error);
      return;
    }
    setAdding(false);
    setDraft("");
    setError(undefined);
    toast(`${first.hostname} was added. Verify ownership to continue.`);
  }

  function closeAdd() {
    setAdding(false);
    setError(undefined);
  }

  function routing(record: DomainRecord) {
    const advice = routingAdvice(record.hostname, routingTarget);
    const order = advice.emphasis === "root" ? ([advice.root, advice.subdomain] as const) : ([advice.subdomain, advice.root] as const);
    return (
      <div className="space-y-1 rounded-btn bg-surface px-3 py-2 text-xs text-ink-muted">
        <p className="font-semibold text-ink">Point your domain at Climvia</p>
        {order.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {!routingTarget && <p>The address to point to is shown here when Climvia&apos;s production routing is set up.</p>}
      </div>
    );
  }

  function card(record: DomainRecord) {
    const manage = canManage;
    return (
      <div key={record.id} className="space-y-3">
        <AddressRow
          host={record.hostname}
          primary={record.isPrimary}
          tags={
            <>
              <StatusBadge tone={DOMAIN_TONE[record.status]}>{DOMAIN_STATUS_LABEL[record.status]}</StatusBadge>
              {record.isPrimary && <StatusBadge tone="positive">Primary</StatusBadge>}
            </>
          }
          note={STATE_NOTE[record.status]}
          actions={
            <>
              {manage && record.status === "pending_verification" && record.verification && (
                <Button size="sm" disabled={busy} onClick={() => check(record)}>
                  Verify ownership
                </Button>
              )}
              {manage && (record.status === "verified" || record.status === "disabled") && (
                <Button size="sm" disabled={busy} onClick={() => run(() => activateDomain(record.id, record.revision), `${record.hostname} is now active in Climvia.`)}>
                  {record.status === "disabled" ? "Re-enable" : "Activate"}
                </Button>
              )}
              {manage && record.status === "active" && !record.isPrimary && (
                <Button size="sm" disabled={busy} onClick={() => run(() => setMainDomain(record.id, record.revision, true), `${record.hostname} is now the primary website address.`)}>
                  Make primary
                </Button>
              )}
              {manage && record.status === "active" && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => disableDomain(record.id, record.revision), `${record.hostname} was disabled.`)}>
                  Disable
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => copy("Domain", record.hostname)} aria-label={`Copy ${record.hostname}`}>
                <Copy aria-hidden className="size-3.5" />
                Copy
              </Button>
              {manage && (
                <OverflowMenu label={`More actions for ${record.hostname}`}>
                  {(close) => (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        setRemoving(record);
                      }}
                      className="flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left text-sm font-medium text-danger hover:bg-danger-soft"
                    >
                      <Unlink aria-hidden className="size-4" />
                      Remove domain
                    </button>
                  )}
                </OverflowMenu>
              )}
            </>
          }
        />

        {record.status === "pending_verification" && (
          <div className="space-y-2 rounded-card border border-line p-4" aria-label={`Verify ownership of ${record.hostname}`}>
            <p className="text-sm font-semibold text-ink">Verify ownership</p>
            {record.verification ? (
              <>
                <p className="text-sm text-ink-muted">Add this TXT record where your domain&apos;s DNS is managed. Then choose Verify ownership.</p>
                <CopyField label="Record type" value="TXT" onCopy={copy} />
                <CopyField label="Record name" value={record.verification.recordName} onCopy={copy} />
                <CopyField label="Record value" value={record.verification.recordValue} onCopy={copy} />
                <p className="text-xs text-ink-muted">
                  If your DNS provider adds your domain to the name for you, enter only the part before it. DNS changes can take a while to appear.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">Someone who manages the website can verify this domain.</p>
            )}
          </div>
        )}

        {(record.status === "verified" || record.status === "active") && routing(record)}

        {(record.status === "verified" || record.status === "active" || record.status === "disabled") && (
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {ACTIVATION_NOTE}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-card bg-surface-low p-4">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-ink">Domain and publishing are separate</p>
          <p className="text-sm text-ink-muted">Adding, verifying or removing a domain does not change your Website content or Published status.</p>
        </div>
      </div>

      <section aria-labelledby="address-heading" className={cardClasses("lg")}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="address-heading" className="text-base font-semibold text-ink">
              Website address
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">The Climvia address of your Website. A custom domain is added to it, never in its place.</p>
          </div>
          {!mainCustom && <StatusBadge tone="positive">Primary website address</StatusBadge>}
        </div>
        <AddressRow
          host={CLIMVIA_DOMAIN}
          primary={!mainCustom}
          tags={<StatusBadge tone="primary">Climvia domain</StatusBadge>}
          note="This address belongs to your Climvia Website and cannot be removed."
          actions={
            <>
              {canManage && mainCustom && (
                <Button size="sm" disabled={busy} onClick={() => run(() => setMainDomain(mainCustom.id, mainCustom.revision, false), `${CLIMVIA_DOMAIN} is now the primary website address.`)}>
                  Make primary
                </Button>
              )}
              <ButtonLink href={view} variant="secondary" size="sm">
                View website
                <SquareArrowOutUpRight aria-hidden className="size-3.5" />
              </ButtonLink>
              <Button variant="secondary" size="sm" onClick={() => copy("Address", CLIMVIA_DOMAIN)} aria-label={`Copy ${CLIMVIA_DOMAIN}`}>
                <Copy aria-hidden className="size-3.5" />
                Copy
              </Button>
            </>
          }
        />
      </section>

      <section aria-labelledby="custom-heading" className={cardClasses("lg")}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="custom-heading" className="text-base font-semibold text-ink">
              Custom domains
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">Use a web address you already own for your customer-facing Website. Ownership is checked with a DNS record.</p>
          </div>
          {canManage && domains.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              Add domain
            </Button>
          )}
        </div>

        {domains.length > 0 ? (
          <div className="space-y-5">{domains.map(card)}</div>
        ) : (
          <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
            <LinkIcon aria-hidden className="mb-3 size-6 text-primary" />
            <h3 className="text-sm font-semibold text-ink">No custom domain connected</h3>
            <p className="mt-1 max-w-md text-sm text-ink-muted">Add a domain you already own. You will verify it with a DNS record before Climvia serves your website for it.</p>
            {canManage && (
              <Button className="mt-4" variant="secondary" onClick={() => setAdding(true)}>
                <Plus aria-hidden className="size-4" />
                Connect custom domain
              </Button>
            )}
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 px-1 text-xs text-ink-muted">
        <Globe aria-hidden className="size-3.5" />
        Current primary address: <span className="font-mono text-ink">{getPrimaryDomain(website.site, website.domain)}</span>
      </p>

      <Modal
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title="Remove custom domain?"
        description={`${removing?.hostname ?? "This domain"} will no longer be used by this Website. Your Climvia address stays available.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              disabled={busy}
              onClick={async () => {
                const target = removing;
                if (!target) return;
                await run(() => removeDomain(target.id, target.revision), `${target.hostname} was removed.`);
                setRemoving(undefined);
              }}
            >
              Remove domain
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 rounded-card bg-surface-low p-3 text-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          Climvia stops showing your website for this domain at once. If you add it again later you will need to verify it again with a new record.
        </p>
        <dl className="space-y-2 rounded-card border border-line p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Domain being removed</dt>
            <dd className="font-mono break-all text-ink">{removing?.hostname}</dd>
          </div>
        </dl>
      </Modal>

      <Modal
        open={adding}
        onClose={closeAdd}
        title="Connect custom domain"
        description="Enter a web address you already own. You will prove you own it with a DNS record; nothing is served until you verify and activate it."
        footer={
          <>
            <Button variant="secondary" onClick={closeAdd}>
              Cancel
            </Button>
            <Button type="submit" form="connect-domain-form" disabled={busy}>
              Add domain
            </Button>
          </>
        }
      >
        <form id="connect-domain-form" onSubmit={add} noValidate>
          <Input
            label="Domain name"
            placeholder="www.yourbusiness.com"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            error={error}
            autoComplete="off"
            spellCheck={false}
          />
        </form>
      </Modal>
    </div>
  );
}
