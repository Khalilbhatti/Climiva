"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Copy, EllipsisVertical, Globe, Info, Link as LinkIcon, Plus, ShieldCheck, SquareArrowOutUpRight, Unlink } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { CLIMVIA_DOMAIN, getPrimaryDomain } from "@/data/website";
import { normalizeDomain } from "@/lib/website-state";
import { previewHref } from "./site-links";
import { useWebsite } from "./WebsiteProvider";

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

function AddressRow({
  host,
  tags,
  note,
  primary,
  actions,
}: {
  host: string;
  tags: ReactNode;
  note: string;
  primary: boolean;
  actions: ReactNode;
}) {
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

export function DomainManager() {
  const { site, connectCustomDomain, makeCustomPrimary, makeClimviaPrimary, removeCustomDomain } = useWebsite();
  const { toast } = useToast();
  const [removing, setRemoving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();

  const { custom, primary } = site.domain;
  const view = previewHref("home", site.published);

  async function copy(host: string) {
    try {
      await navigator.clipboard.writeText(host);
      toast("Address copied to clipboard.");
    } catch {
      toast(`Copy this address: ${host}`);
    }
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    const host = normalizeDomain(draft);
    if (!host) {
      setError("Enter a domain name like www.yourbusiness.com.");
      return;
    }
    connectCustomDomain(host);
    setConnecting(false);
    setDraft("");
    setError(undefined);
    toast(`Domain connected. ${host} is now connected to your Website.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-card bg-surface-low p-4">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-ink">Domain and publishing are separate</p>
          <p className="text-sm text-ink-muted">Connecting or removing a domain does not change your Website content or Published status.</p>
        </div>
      </div>

      <section aria-labelledby="address-heading" className={cardClasses("lg")}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="address-heading" className="text-base font-semibold text-ink">
              Website address
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">The public address where visitors and customers can access your Climvia Website.</p>
          </div>
          {primary === "climvia" && <StatusBadge tone="positive">Primary website address</StatusBadge>}
        </div>
        <AddressRow
          host={CLIMVIA_DOMAIN}
          primary={primary === "climvia"}
          tags={
            <>
              <StatusBadge tone="primary">Climvia domain</StatusBadge>
              <StatusBadge tone="positive">Active</StatusBadge>
            </>
          }
          note="This address is available automatically for your Climvia Website."
          actions={
            <>
              {custom && primary === "custom" && (
                <Button
                  size="sm"
                  onClick={() => {
                    makeClimviaPrimary();
                    toast(`${CLIMVIA_DOMAIN} is now the primary website address.`);
                  }}
                >
                  Make primary
                </Button>
              )}
              <ButtonLink href={view} variant="secondary" size="sm">
                View website
                <SquareArrowOutUpRight aria-hidden className="size-3.5" />
              </ButtonLink>
              <Button variant="secondary" size="sm" onClick={() => copy(CLIMVIA_DOMAIN)} aria-label={`Copy ${CLIMVIA_DOMAIN}`}>
                <Copy aria-hidden className="size-3.5" />
                Copy
              </Button>
            </>
          }
        />
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          The Climvia domain cannot be deleted. If you connect a custom domain, both addresses can access this Website.
        </p>
      </section>

      <section aria-labelledby="custom-heading" className={cardClasses("lg")}>
        <div className="mb-4">
          <h2 id="custom-heading" className="text-base font-semibold text-ink">
            Custom domain
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">Connect a web address you already own to brand your customer-facing HVAC website.</p>
        </div>

        {custom ? (
          <>
            <AddressRow
              host={custom}
              primary={primary === "custom"}
              tags={
                <>
                  <StatusBadge tone="positive">Connected</StatusBadge>
                  {primary === "custom" && <StatusBadge tone="primary">Primary</StatusBadge>}
                </>
              }
              note="This domain is connected to your Climvia Website."
              actions={
                <>
                  {primary !== "custom" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        makeCustomPrimary();
                        toast(`${custom} is now the primary website address.`);
                      }}
                    >
                      Make primary
                    </Button>
                  )}
                  <ButtonLink href={view} variant="secondary" size="sm">
                    View website
                    <SquareArrowOutUpRight aria-hidden className="size-3.5" />
                  </ButtonLink>
                  <Button variant="secondary" size="sm" onClick={() => copy(custom)} aria-label={`Copy ${custom}`}>
                    <Copy aria-hidden className="size-3.5" />
                    Copy
                  </Button>
                  <OverflowMenu label={`More actions for ${custom}`}>
                    {(close) => (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          setRemoving(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left text-sm font-medium text-danger hover:bg-danger-soft"
                      >
                        <Unlink aria-hidden className="size-4" />
                        Remove domain
                      </button>
                    )}
                  </OverflowMenu>
                </>
              }
            />
            <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
              <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Visitors on {custom} see the same published website as {CLIMVIA_DOMAIN}.
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
            <LinkIcon aria-hidden className="mb-3 size-6 text-primary" />
            <h3 className="text-sm font-semibold text-ink">No custom domain connected</h3>
            <p className="mt-1 max-w-md text-sm text-ink-muted">Connect a domain you already own to use it as your public Website address.</p>
            <Button className="mt-4" variant="secondary" onClick={() => setConnecting(true)}>
              <Plus aria-hidden className="size-4" />
              Connect custom domain
            </Button>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 px-1 text-xs text-ink-muted">
        <Globe aria-hidden className="size-3.5" />
        Current primary address: <span className="font-mono text-ink">{getPrimaryDomain(site.domain)}</span>
      </p>

      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove custom domain?"
        description={`${custom ?? "This domain"} will no longer be connected to this Website. The Climvia domain will remain available.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              onClick={() => {
                removeCustomDomain();
                setRemoving(false);
                toast(`Custom domain removed. ${CLIMVIA_DOMAIN} is now your primary website address.`);
              }}
            >
              Remove domain
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 rounded-card bg-surface-low p-3 text-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          {CLIMVIA_DOMAIN} will become the primary website address.
        </p>
        <dl className="space-y-2 rounded-card border border-line p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Domain being removed</dt>
            <dd className="font-mono text-ink">{custom}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">New primary address</dt>
            <dd className="font-mono text-primary">{CLIMVIA_DOMAIN}</dd>
          </div>
        </dl>
      </Modal>

      <Modal
        open={connecting}
        onClose={() => {
          setConnecting(false);
          setError(undefined);
        }}
        title="Connect custom domain"
        description="Enter a web address you already own. Your published website will be available on it as well as on your Climvia address."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConnecting(false);
                setError(undefined);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="connect-domain-form">
              Connect domain
            </Button>
          </>
        }
      >
        <form id="connect-domain-form" onSubmit={connect} noValidate>
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
