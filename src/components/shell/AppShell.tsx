import type { ReactNode } from "react";
import { ShellMain } from "./ShellMain";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * The one global Climvia shell: top bar + sidebar + content canvas.
 * Mounted once in app/(workspace)/layout.tsx, so it persists while modules change.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-btn focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <TopBar />
      <div className="flex">
        <Sidebar />
        <ShellMain>{children}</ShellMain>
      </div>
    </div>
  );
}
