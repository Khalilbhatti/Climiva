import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Single primary action, per the handoff's empty-state rule. */
  action?: ReactNode;
  /** "h1" when this state is the whole page (a record that cannot be found); otherwise it sits under the page's own heading. */
  as?: "h1" | "h2";
};

export function EmptyState({ icon: Icon, title, description, action, as: Heading = "h2" }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-card bg-surface-low text-primary">
        <Icon aria-hidden className="size-6" />
      </div>
      <Heading className="text-base font-semibold text-ink">{title}</Heading>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
