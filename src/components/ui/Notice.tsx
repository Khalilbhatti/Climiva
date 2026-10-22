import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

/** A quiet note that says something true the person needs to know before acting: an icon, plain words, no colour of alarm. */
export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-card bg-surface-low p-4", className)}>
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <p className="text-sm text-ink">{children}</p>
    </div>
  );
}
