import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { AppHref } from "@/config/routes";

export function BackLink({ href, children }: { href: AppHref; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
