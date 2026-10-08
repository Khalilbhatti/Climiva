import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "./Input";

type SearchInputProps = ComponentProps<"input"> & {
  /** Decorative keyboard hint shown at the right edge, e.g. "⌘K". */
  shortcutHint?: string;
  /** Classes for the outer wrapper (the input itself always fills it). */
  wrapperClassName?: string;
};

/** Callers must supply an `aria-label`: the field has no visible label. */
export function SearchInput({ shortcutHint, wrapperClassName, className, ...props }: SearchInputProps) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-faint"
      />
      <input
        type="search"
        className={cn(
          fieldClasses,
          "pl-10 [&::-webkit-search-cancel-button]:appearance-none",
          shortcutHint ? "pr-14" : "pr-4",
          className,
        )}
        {...props}
      />
      {shortcutHint && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-micro text-ink-muted shadow-card"
        >
          {shortcutHint}
        </kbd>
      )}
    </div>
  );
}
