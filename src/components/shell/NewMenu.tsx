"use client";

import Link from "next/link";
import type { Route } from "next";
import { CalendarPlus, ChevronDown, CreditCard, Plus, UserPlus, Wrench, type LucideIcon } from "lucide-react";
import { useCan } from "@/components/workspace/WorkspaceProvider";
import { cn } from "@/lib/cn";
import type { Capability } from "@/lib/policy";
import { usePopover } from "./usePopover";

type Entry = { label: string; hint: string; href: Route; icon: LucideIcon; capability: Capability };

/** The few things a business creates every week, each opening the one create flow of its own page. Nothing here is a second implementation. */
const ENTRIES: Entry[] = [
  { label: "Booking", hint: "Book a customer visit", href: "/bookings?new=1", icon: CalendarPlus, capability: "operations:manage" },
  { label: "Customer", hint: "Add someone you serve", href: "/customers?new=1", icon: UserPlus, capability: "customers:manage" },
  { label: "Service", hint: "Add something customers can book", href: "/services?new=1", icon: Wrench, capability: "services:manage" },
  { label: "Payment", hint: "Record money a customer paid", href: "/payments?record=1", icon: CreditCard, capability: "financials:manage" },
];

/**
 * "+ New": the quick way to start the common create flows from any page. It lists only what this person may do (a member who may create nothing is not shown
 * the button at all); the page opened asks the server again, and the database a third time.
 */
export function NewMenu() {
  const { open, setOpen, root, button, panelId } = usePopover();
  const allowed = {
    "operations:manage": useCan("operations:manage"),
    "customers:manage": useCan("customers:manage"),
    "services:manage": useCan("services:manage"),
    "financials:manage": useCan("financials:manage"),
  } as Partial<Record<Capability, boolean>>;
  const entries = ENTRIES.filter((entry) => allowed[entry.capability]);
  if (entries.length === 0) return null;

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-2 text-sm font-semibold text-white shadow-card transition-colors hover:bg-primary-hover max-lg:px-2.5"
      >
        <Plus aria-hidden className="size-4" />
        <span className="max-lg:sr-only">New</span>
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform max-lg:hidden", open && "rotate-180")} />
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="Create new" className="absolute top-full right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 shadow-overlay">
          <p className="px-3 pt-1 pb-1 text-micro font-semibold tracking-wider text-ink-muted uppercase">Create new</p>
          <ul>
            {entries.map((entry) => (
              <li key={entry.href}>
                <Link href={entry.href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-btn px-3 py-2.5 transition-colors hover:bg-surface-low">
                  <entry.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{entry.label}</span>
                    <span className="block text-xs text-ink-muted">{entry.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
