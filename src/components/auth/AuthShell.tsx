import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

/**
 * The frame for Log in, Sign up and Set up: the Climvia mark, one card, one heading. Deliberately plain: this is a door,
 * not a marketing page.
 */
export function AuthShell({ title, description, children, footer, wide }: { title: string; description: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-canvas px-4 py-10">
      <Link href="/" aria-label="Climvia" className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-btn bg-primary text-lg font-bold tracking-tight text-white shadow-card">
          C
        </span>
        <span className="text-xl font-bold tracking-tight text-ink">Climvia</span>
      </Link>
      <main className={`mt-8 w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <Card>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </Card>
        {footer && <p className="mt-5 text-center text-sm text-ink-muted">{footer}</p>}
      </main>
    </div>
  );
}

/** A form-level problem (wrong password, too many attempts). Announced when it appears. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-btn border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
