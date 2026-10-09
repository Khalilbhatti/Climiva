"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useServices } from "@/components/services/ServicesProvider";
import { useTeam } from "@/components/team/TeamProvider";
import type { CustomerBook } from "@/data/customers";
import type { Directory } from "@/data/directory";

const BookContext = createContext<CustomerBook | null>(null);

/**
 * The directory of the active workspace: its customers, properties and equipment, its Services and its team.
 *
 * The Services and the team are the live copies (a change in the Services or Team module shows in the Bookings pickers at
 * once); the customer book is what the server loaded. Everything is the ACTIVE organization's: the provider is keyed by
 * organization at the root, so nothing can carry over from another business.
 */
export function DirectoryProvider({ book, children }: { book: CustomerBook; children: ReactNode }) {
  return <BookContext value={book}>{children}</BookContext>;
}

/** A page that loaded its own customer book (the Customers pages) shows it to everything beneath, in place of the root one. */
export function CustomerBookScope({ book, children }: { book: CustomerBook; children: ReactNode }) {
  return <BookContext value={book}>{children}</BookContext>;
}

/** The business's directory. Pass it to the selectors in data/customers, data/services and data/team. */
export function useDirectory(): Directory {
  const book = useContext(BookContext);
  if (!book) throw new Error("useDirectory must be used inside <DirectoryProvider>.");
  const { services } = useServices();
  const { data: team } = useTeam();
  return useMemo(() => ({ ...book, services, team }), [book, services, team]);
}
