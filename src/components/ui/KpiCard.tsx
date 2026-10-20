import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { cardClasses } from "./Card";

type KpiCardProps = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Supporting line under the value. */
  hint: string;
  /** Small status dot before the hint. */
  hintDot?: boolean;
  /** "positive" colours the icon and value mint-green (money received). */
  tone?: "default" | "positive";
  /** When set, the whole card is a link to the owning module. */
  href?: Route;
};

export function KpiCard({ label, value, icon: Icon, hint, hintDot = false, tone = "default", href }: KpiCardProps) {
  const positive = tone === "positive";

  const content = (
    <>
      <div className="mb-3 flex items-center justify-between text-ink-muted">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        <Icon aria-hidden className={cn("size-5", positive ? "text-positive" : "text-primary")} />
      </div>
      <div className={cn("text-3xl font-bold tracking-tight", positive ? "text-positive" : "text-ink")}>{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
        {hintDot && <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full bg-positive" />}
        <span className="min-w-0 [overflow-wrap:anywhere]">{hint}</span>
      </div>
    </>
  );

  const classes = cardClasses("md", "block transition-colors hover:border-line-strong");

  return href ? (
    <Link href={href} className={classes}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  );
}
