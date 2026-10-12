"use client";

import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import type { MenuAction } from "@/components/ui/ActionMenu";
import { MAX_SECTIONS_PER_PAGE } from "@/lib/site-template";
import { pageIn, sectionLock } from "@/lib/site-builder";
import { useBuilder } from "./BuilderProvider";

/**
 * What can be done to a section, with the reason when it cannot. The section navigator's menu, the toolbar over a selected section in the
 * canvas and the inspector all offer exactly this list, so a section behaves the same wherever it is acted on.
 */
export function useSectionActions(pageKey: string, sectionKey: string): MenuAction[] {
  const b = useBuilder();
  const page = pageIn(b.content, pageKey);
  const index = page?.sections.findIndex((section) => section.key === sectionKey) ?? -1;
  const section = index === -1 ? undefined : page?.sections[index];
  if (!page || !section) return [];

  const lock = sectionLock(b.content, pageKey, sectionKey);
  const full = page.sections.length >= MAX_SECTIONS_PER_PAGE;
  const off = b.readOnly;
  return [
    { id: "up", label: "Move up", icon: ArrowUp, disabled: off || index === 0, reason: off ? "Only an owner or admin can change the website." : "It is already the first section.", onSelect: () => b.moveSectionBy(pageKey, sectionKey, -1) },
    { id: "down", label: "Move down", icon: ArrowDown, disabled: off || index === page.sections.length - 1, reason: off ? "Only an owner or admin can change the website." : "It is already the last section.", onSelect: () => b.moveSectionBy(pageKey, sectionKey, 1) },
    { id: "duplicate", label: "Duplicate", icon: Copy, disabled: off || full, reason: off ? "Only an owner or admin can change the website." : `A page has up to ${MAX_SECTIONS_PER_PAGE} sections.`, onSelect: () => b.duplicateSection(pageKey, sectionKey) },
    section.visible
      ? { id: "hide", label: "Hide section", icon: EyeOff, disabled: off || Boolean(lock), reason: off ? "Only an owner or admin can change the website." : lock, onSelect: () => b.setVisible(pageKey, sectionKey, false) }
      : { id: "show", label: "Show section", icon: Eye, disabled: off, reason: "Only an owner or admin can change the website.", onSelect: () => b.setVisible(pageKey, sectionKey, true) },
    { id: "delete", label: "Delete section", icon: Trash2, destructive: true, disabled: off || Boolean(lock), reason: off ? "Only an owner or admin can change the website." : lock, onSelect: () => b.removeSection(pageKey, sectionKey) },
  ];
}
