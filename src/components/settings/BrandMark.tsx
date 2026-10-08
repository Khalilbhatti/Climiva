"use client";

import type { ReactNode } from "react";
import { Snowflake } from "lucide-react";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/format";
import { useSettings } from "./SettingsProvider";

/**
 * The business's mark in a customer-facing frame, from the saved Branding: the file chosen in Settings, otherwise the
 * built-in crest the baseline names, and when the logo has been removed the business's initials. `className` sets the
 * size and corner radius; the colours follow the logo state. `crest` is how a frame draws the built-in mark.
 */
export function BrandMark({ className, crest }: { className?: string; crest?: ReactNode }) {
  const { settings } = useSettings();
  const { logo } = settings.branding;

  if (logo?.src) {
    return (
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-surface ring-1 ring-line", className)}>
        {/* A local object URL chosen in Settings, so there is nothing for next/image to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo.src} alt="" className="size-full object-contain" />
      </span>
    );
  }

  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center bg-primary font-bold text-white", className)}>
      {logo ? (crest ?? <Snowflake className="size-1/2" />) : getInitials(settings.business.name)}
    </span>
  );
}
