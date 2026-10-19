import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PlatformShell } from "@/components/platform-admin/PlatformShell";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Platform", template: "%s · Platform" }, robots: { index: false, follow: false } };

/**
 * Every page of the console. The check lives here AND in each page (a layout is not re-run on every client navigation, and a page may render
 * alongside it), and the database functions refuse a non-administrator a third time.
 */
export default async function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin();
  return <PlatformShell admin={admin}>{children}</PlatformShell>;
}
