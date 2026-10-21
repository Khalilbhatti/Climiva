import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabNav } from "@/components/ui/TabNav";

/** Settings people look for here that are set where they are used. Each is a link, so nothing is hunted for. */
const ELSEWHERE: { label: string; text: string; href: Route }[] = [
  { label: "Team permissions", text: "Who is on your team and what each person can do.", href: "/team" },
  { label: "Booking", text: "How customers book each service, and your booking page.", href: "/website/booking" },
  { label: "Domains", text: "Your website address and any custom domain.", href: "/website/domain" },
];

/** Settings: one header and one set of section tabs; each section is its own route. */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <PageHeader title="Settings" description="Manage your business information and workspace preferences." />
      <TabNav
        label="Settings sections"
        items={[
          { label: "Business information", href: "/settings" },
          { label: "Business hours", href: "/settings/hours" },
          { label: "Branding", href: "/settings/branding" },
          { label: "Workspace preferences", href: "/settings/preferences" },
          { label: "My profile", href: "/settings/profile" },
        ]}
      />
      {children}
      <section aria-label="Other settings" className={cardClasses("md", "space-y-3")}>
        <h2 className="text-base font-semibold text-ink">Looking for something else?</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {ELSEWHERE.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="group flex h-full items-start justify-between gap-3 rounded-card border border-line bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-primary-subtle/40">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink group-hover:text-primary">{item.label}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">{item.text}</span>
                </span>
                <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
