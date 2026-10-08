import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Table shell: styled primitives only. Modules compose their own columns and rows.
 *
 *   <Table>
 *     <TableHead><tr><TableHeaderCell>Customer</TableHeaderCell></tr></TableHead>
 *     <TableBody><TableRow><TableCell>Sarah Mitchell</TableCell></TableRow></TableBody>
 *   </Table>
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="relative overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-b border-line bg-surface-low text-mini font-bold tracking-wider text-ink-muted uppercase", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-canvas", className)} {...props} />;
}

export function TableHeaderCell({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cn("px-4 py-3", className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3.5 text-ink", className)} {...props} />;
}
