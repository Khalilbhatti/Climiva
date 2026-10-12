"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * The page area of the workspace shell. Every module sits in a padded column of a readable width; the Website Builder is a tool that uses
 * the whole area (its own bar, panels and canvas), still inside the same shell, sidebar and top bar.
 */
export function ShellMain({ children }: { children: ReactNode }) {
  const wide = usePathname().startsWith("/website/builder");
  return (
    <main id="main-content" tabIndex={-1} className={wide ? "min-w-0 flex-1 focus:outline-none" : "min-w-0 flex-1 p-5 focus:outline-none lg:p-8"}>
      {wide ? children : <div className="mx-auto max-w-content space-y-8">{children}</div>}
    </main>
  );
}
