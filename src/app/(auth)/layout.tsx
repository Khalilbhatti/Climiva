import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Log in, Sign up and set-up: doors, not pages to be found. They are never indexed, and nothing about a person is read to draw them (each page asks the
 * session itself only to send someone who is already signed in on their way).
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
