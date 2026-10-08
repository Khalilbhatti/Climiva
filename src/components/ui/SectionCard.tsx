import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { cardClasses } from "./Card";

type SectionCardProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Right-aligned header content, typically a link. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A titled Card. The heading names the region for assistive tech. */
export function SectionCard({ title, description, icon: Icon, action, children, className }: SectionCardProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={cn(cardClasses("lg"), className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon aria-hidden className="size-5 shrink-0 text-primary" />}
          <div>
            <h2 id={headingId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
