import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppProviders } from "@/components/providers/AppProviders";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
