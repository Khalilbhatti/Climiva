import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Right-aligned primary actions. */
  actions?: ReactNode;
};

/** Every module opens with this: one h1, one supporting line, optional actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
