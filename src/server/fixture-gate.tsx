import "server-only";
import type { ReactNode } from "react";
import { ModuleUnavailable, PublicUnavailable } from "@/components/workspace/ModuleUnavailable";
import { requireWorkspaceContext, resolveWorkspace } from "./workspace";

/**
 * The transitional gate for modules still backed by the built-in sample dataset (see docs/saas-architecture.md,
 * "Transitional fixtures"). Call it first in every page and layout of such a module:
 *
 *     const gate = await fixtureGate("Customers");
 *     if (gate) return gate;
 *
 * It does two things. It is an authentication check (an anonymous visitor is redirected to Log in, someone with no workspace
 * to set-up). And it returns a replacement page for any workspace that is not the sample business, so the sample content
 * is never even rendered for them. The check lives in each page, next to the content it protects, because a layout
 * cannot stop the pages beneath it from running (Next.js, "Layouts and auth checks"); e2e/server-boundary.spec.ts fails
 * if a fixture-backed page forgets it.
 */
export async function fixtureGate(moduleName: string): Promise<ReactNode | null> {
  const { snapshot } = await requireWorkspaceContext();
  if (snapshot.hasSampleData) return null;
  return <ModuleUnavailable name={moduleName} business={snapshot.organization.name} />;
}

/** For the customer-facing previews: no login redirect (they must stay reachable), but sample content only for the sample business. */
export async function publicGate(): Promise<ReactNode | null> {
  const state = await resolveWorkspace();
  if (state.status === "ready" && state.context.snapshot.hasSampleData) return null;
  return <PublicUnavailable />;
}

/** For `generateMetadata`, which runs apart from the page: does this request get the sample content at all? */
export async function hasSampleDataAccess(): Promise<boolean> {
  const state = await resolveWorkspace();
  return state.status === "ready" && state.context.snapshot.hasSampleData;
}
