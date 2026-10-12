import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppProviders } from "@/components/providers/AppProviders";
import { getCoreSnapshot } from "@/server/core-data";
import { resolveWorkspace } from "@/server/workspace";
import "./globals.css";

// Inter (OFL), self-hosted: no third-party font request at build or runtime.
const inter = localFont({
  src: "./fonts/Inter-latin-variable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Climvia Business Workspace",
    template: "%s · Climvia",
  },
  description: "Run bookings, jobs, payments and growth for your HVAC business in one workspace.",
};

/**
 * The providers live here, once, around every route, so the workspace and the customer-facing previews share one
 * session and moving between them keeps what was edited. They are mounted only for someone signed in to a workspace
 * (the Log in, Sign up and Set up pages have none), and with the settings the SERVER read for that person's active
 * workspace this request. Signing in or out and switching workspace are always full page loads, so what is mounted here
 * can never outlive the person or workspace it was built for. Each page still checks for itself (see src/server/workspace.ts).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const state = await resolveWorkspace();
  const snapshot = state.status === "ready" ? state.context.snapshot : null;
  const core = snapshot ? await getCoreSnapshot() : null;
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink">
        {snapshot && core ? (
          <AppProviders key={snapshot.organization.id} snapshot={snapshot} core={core}>
            {children}
          </AppProviders>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
