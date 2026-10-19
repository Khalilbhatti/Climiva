"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The filters on a narrow screen fold behind one button; on a wide one they are simply there. The links inside are drawn on the server (they are
 * ordinary links, each a search of its own), so this only decides whether they are showing.
 */
export function FilterDisclosure({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-btn border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink lg:hidden"
      >
        <span>Filters{active > 0 ? ` (${active} applied)` : ""}</span>
        <ChevronDown aria-hidden className={cn("size-4 text-ink-muted transition-transform", open && "rotate-180")} />
      </button>
      <div id={panel} className={cn("mt-3 lg:mt-0 lg:block", open ? "block" : "hidden")}>
        {children}
      </div>
    </div>
  );
}
