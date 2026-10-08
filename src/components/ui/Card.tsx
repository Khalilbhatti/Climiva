import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Padding = "md" | "lg";

const paddings: Record<Padding, string> = {
  md: "p-5",
  lg: "p-6",
};

export function cardClasses(padding: Padding = "lg", className?: string) {
  return cn("rounded-card border border-line bg-surface shadow-card", paddings[padding], className);
}

export function Card({ padding, className, ...props }: ComponentProps<"div"> & { padding?: Padding }) {
  return <div className={cardClasses(padding, className)} {...props} />;
}
