import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, CalendarRange, Globe, IdCard, Rocket, Store, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { BusinessInfoCard } from "./BusinessInfoCard";

/**
 * The Overview for a workspace that is not the sample business. It has a business record (name, contact, hours, time zone) and nothing else yet: no
 * customers, bookings, jobs or payments exist for it, so no totals are shown and none are invented. What it offers instead are the things a new
 * business usually does first, each one a link, in no required order: nothing here is a gate, and every area works whether or not any of them is done.
 */
const NEXT_STEPS: { href: Route; icon: LucideIcon; title: string; text: string }[] = [
  { href: "/services", icon: Wrench, title: "Add your services", text: "What you offer, how long it takes, what it costs and how customers book it." },
  { href: "/team", icon: IdCard, title: "Set up your team", text: "Add the people who do the work and choose what each of them can do." },
  { href: "/settings/hours", icon: CalendarRange, title: "Check your business hours", text: "The hours you entered decide which times customers can book." },
  { href: "/website", icon: Globe, title: "Customize your website", text: "Your site is private until you publish it." },
  { href: "/marketplace-listing", icon: Store, title: "Publish your Marketplace listing", text: "Choose the services and places homeowners can find you for." },
];

export function NewWorkspaceOverview({ business }: { business: string }) {
  return (
    <>
      <PageHeader title="Workspace Overview" description={`Your workspace for ${business}.`} />
      <Card padding="lg" className="space-y-5">
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
            <Rocket className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink">Your workspace is ready</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Your business information, hours and preferences are saved. Nothing else has been added for you: no customers, bookings or money, and nothing is public. Start with any of
              these, in any order, or skip them all.
            </p>
          </div>
        </div>
        <ul aria-label="Next steps" className="grid gap-3 md:grid-cols-2">
          {NEXT_STEPS.map((step) => (
            <li key={step.href}>
              <Link href={step.href} className="group flex h-full items-start gap-3 rounded-card border border-line bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-primary-subtle/40">
                <step.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink group-hover:text-primary">{step.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">{step.text}</span>
                </span>
                <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <BusinessInfoCard />
    </>
  );
}
