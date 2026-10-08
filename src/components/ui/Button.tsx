import Link from "next/link";
import type { ComponentProps } from "react";
import type { AppHref } from "@/config/routes";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "tertiary" | "destructive" | "destructive-solid";
type Size = "lg" | "md" | "sm";

type StyleProps = {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-btn font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white shadow-card hover:bg-primary-hover",
  secondary: "border border-line bg-surface text-ink hover:bg-hover",
  tertiary: "text-primary hover:bg-primary-subtle",
  destructive: "bg-danger-soft text-danger hover:bg-danger-line",
  "destructive-solid": "bg-danger text-white shadow-card hover:bg-danger-hover",
};

const sizes: Record<Size, string> = {
  lg: "px-4 py-3 text-sm", // 44px — page-level primary actions
  md: "px-4 py-2 text-sm",
  sm: "px-3 py-1.5 text-xs",
};

export function buttonClasses({ variant = "primary", size = "md", className }: StyleProps & { className?: string }) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & StyleProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

/** A real link that looks like a button. Use for navigation; use Button for actions. */
export function ButtonLink({
  variant,
  size,
  className,
  href,
  ...props
}: Omit<ComponentProps<"a">, "href"> & StyleProps & { href: AppHref }) {
  return <Link href={href} className={buttonClasses({ variant, size, className })} {...props} />;
}
