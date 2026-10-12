import type { Metadata } from "next";
import localFont from "next/font/local";
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
 * The document, the font and the global styles: nothing else. This layout reads no session, no workspace and no data, and mounts no provider,
 * so a route that is not part of the signed-in workspace (a published website, a Marketplace listing, Log in, Sign up, set-up) never carries
 * anyone's private state because of who happens to be signed in. The workspace's providers are mounted by the route groups that own that
 * state (see src/server/workspace-providers.tsx): `(signed-in)`, which holds the workspace and the Draft previews.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink">{children}</body>
    </html>
  );
}
