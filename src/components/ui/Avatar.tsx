import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/format";

const sizes = {
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-14 text-lg",
} as const;

/** Initials avatar, or a photo when one is given. Decorative: always render the person's name as text beside it. */
export function Avatar({ name, size = "md", src }: { name: string; size?: keyof typeof sizes; src?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/20 bg-primary-subtle font-semibold text-primary",
        sizes[size],
      )}
    >
      {src ? (
        // A local object URL chosen in Settings, so there is nothing for next/image to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        getInitials(name)
      )}
    </span>
  );
}
