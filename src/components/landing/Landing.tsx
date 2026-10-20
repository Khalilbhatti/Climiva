import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarCheck, CalendarRange, ClipboardCheck, ReceiptText, Search, Star } from "lucide-react";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Climvia's front door, for anyone who is not signed in to a business: two doors (find HVAC service, or run an HVAC business on Climvia), the path one
 * service call takes through the product, what a business gets, and how the Marketplace works for a homeowner.
 *
 * Everything on it is something Climvia does today, said plainly. It states no number of businesses or customers, no saving, no response time, no
 * coverage and no testimonial, because none of those is a fact the product holds. It reads no session and no data, so it is the same for everyone.
 */

const STOPS: { icon: typeof Search; name: string; text: string }[] = [
  { icon: Search, name: "Found", text: "A homeowner searches the Marketplace by the service they need and where they are." },
  { icon: CalendarCheck, name: "Booked", text: "They book online or ask for an appointment. It arrives in your Bookings." },
  { icon: CalendarRange, name: "Scheduled", text: "You put it on the Schedule and assign it to someone on your team." },
  { icon: ClipboardCheck, name: "Done", text: "The job keeps its work details, from the first visit to the last." },
  { icon: ReceiptText, name: "Billed", text: "You write the quote, invoice the work and record the payment." },
  { icon: Star, name: "Reviewed", text: "You give the customer a link to review the work. They choose whether it appears on your profile." },
];

const CAPABILITIES: { title: string; items: { name: string; text: string }[] }[] = [
  {
    title: "Run the day",
    items: [
      { name: "Bookings", text: "Requests and appointments in one list." },
      { name: "Schedule", text: "Who is going where, and when." },
      { name: "Jobs", text: "Work details from start to finish." },
      { name: "Customers", text: "Contacts, properties and history." },
    ],
  },
  {
    title: "Get paid",
    items: [
      { name: "Quotes & Invoices", text: "Price the work and bill it." },
      { name: "Payments", text: "Record what each customer paid." },
      { name: "Services", text: "What you offer, what it costs, how it is booked." },
      { name: "Team", text: "Your people and what each can do." },
    ],
  },
  {
    title: "Be found",
    items: [
      { name: "Website Builder", text: "Build and publish your own website." },
      { name: "Marketplace", text: "A listing homeowners can search, when you choose." },
      { name: "Reviews", text: "Ask customers for reviews and reply to them." },
    ],
  },
  {
    title: "Keep customers",
    items: [
      { name: "Maintenance Plans", text: "Recurring visits you can see coming." },
      { name: "Marketing", text: "Plan campaigns for the customers you have." },
      { name: "Analytics", text: "Bookings, revenue and reviews over time." },
    ],
  },
];

function Band({ id, label, className, children }: { id?: string; label: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id ?? label}-heading`} className={className}>
      {children}
    </section>
  );
}

export function Landing() {
  return (
    <div className="min-h-dvh bg-canvas">
      <PublicHeader tone="on-dark" className="bg-primary" />
      <main>
        <div className="relative overflow-hidden bg-primary text-white">
          <div aria-hidden className="pointer-events-none absolute -top-20 -right-32 hidden size-[34rem] rounded-full border border-white/10 md:block">
            <div className="absolute inset-10 rounded-full border border-white/10" />
            <div className="absolute inset-20 rounded-full border border-white/10" />
            <div className="absolute inset-[7.5rem] rounded-full border border-white/10" />
            <div className="absolute inset-40 rounded-full border border-white/10" />
          </div>
          <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-12 md:pt-10 md:pb-20">
            <p className="text-micro font-semibold tracking-wider text-white/80 uppercase">Climvia for HVAC</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-balance md:text-6xl md:leading-[1.02]">Find HVAC service. Run the business behind it.</h1>
            <p className="mt-5 max-w-2xl text-lg text-white/85">
              Climvia is where homeowners find HVAC businesses, and where those businesses take bookings, schedule the work, send quotes and invoices, and collect reviews.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <section aria-labelledby="door-homeowner" className="flex flex-col rounded-card bg-surface p-6 text-ink shadow-overlay">
                <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">For homeowners</p>
                <h2 id="door-homeowner" className="mt-2 text-2xl font-bold tracking-tight">
                  Find HVAC services
                </h2>
                <p className="mt-2 flex-1 text-sm text-ink-muted">
                  Search by the service you need and where you are. See what each business offers and where it works, then book or ask for an appointment online.
                </p>
                <div className="mt-6">
                  <Link prefetch={false} href="/marketplace" className={buttonClasses({ variant: "primary", size: "lg" })}>
                    Find a Service
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                </div>
              </section>
              <section aria-labelledby="door-business" className="flex flex-col rounded-card border border-white/25 bg-white/10 p-6 shadow-overlay">
                <p className="text-micro font-semibold tracking-wider text-white/80 uppercase">For HVAC businesses</p>
                <h2 id="door-business" className="mt-2 text-2xl font-bold tracking-tight">
                  Run your HVAC business with Climvia
                </h2>
                <p className="mt-2 flex-1 text-sm text-white/85">One workspace for bookings, the schedule, jobs, customers, quotes, invoices and reviews. Add a website and a Marketplace listing when you are ready.</p>
                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <Link prefetch={false} href="/signup" className="inline-flex items-center justify-center gap-2 rounded-btn bg-white px-5 py-3 text-sm font-semibold text-primary hover:bg-primary-subtle focus-visible:outline-white">
                    List Your Business
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                  <Link prefetch={false} href="/login" className="inline-flex min-h-8 items-center rounded-btn text-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-white">
                    Already have a workspace? Sign in
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </div>

        <Band id="service-call" label="service-call" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
          <p className="text-micro font-semibold tracking-wider text-primary uppercase">One service call</p>
          <h2 id="service-call-heading" className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-balance text-ink md:text-4xl">
            From the first search to the last review
          </h2>
          <p className="mt-3 max-w-2xl text-base text-ink-muted">The same record follows a customer through Climvia, so nothing is typed twice.</p>
          <ol className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {STOPS.map((stop, index) => (
              <li key={stop.name} className="relative flex gap-4">
                <div className="flex flex-col items-center">
                  <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary-subtle text-primary">
                    <stop.icon className="size-5" />
                  </span>
                  {index < STOPS.length - 1 && <span aria-hidden className="mt-2 hidden w-px flex-1 bg-line-strong sm:block lg:hidden" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    <span className="sr-only">Step {index + 1}: </span>
                    {stop.name}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">{stop.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Band>

      <Band id="for-businesses" label="for-businesses" className="scroll-mt-4 border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div>
              <p className="text-micro font-semibold tracking-wider text-primary uppercase">For HVAC businesses</p>
              <h2 id="for-businesses-heading" className="mt-2 text-3xl font-bold tracking-tight text-balance text-ink md:text-4xl">
                Everything you run, in one workspace
              </h2>
              <p className="mt-3 text-base text-ink-muted">
                Sign up, tell us about your business and you have a workspace of your own, with your own customers, services and team. Your website and your Marketplace listing stay private until you publish them.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link prefetch={false} href="/signup" className={buttonClasses({ variant: "primary", size: "lg" })}>
                  List Your Business
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
                <Link prefetch={false} href="/login" className="inline-flex min-h-8 items-center rounded-btn text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {CAPABILITIES.map((group) => (
                <section key={group.title} aria-label={group.title} className="rounded-card border border-line bg-canvas p-5">
                  <h3 className="text-sm font-bold tracking-tight text-ink">{group.title}</h3>
                  <ul className="mt-3 space-y-2.5">
                    {group.items.map((item) => (
                      <li key={item.name} className="text-sm">
                        <span className="font-semibold text-ink">{item.name}</span>
                        <span className="text-ink-muted"> · {item.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </Band>

      <Band id="for-homeowners" label="for-homeowners" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
          <p className="text-micro font-semibold tracking-wider text-primary uppercase">For homeowners</p>
          <h2 id="for-homeowners-heading" className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-balance text-ink md:text-4xl">
            How the Marketplace works
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { title: "You say what you need", text: "Search by the service and the place, such as a ZIP code or a city and state. Filters narrow it by how a business takes bookings." },
              { title: "Businesses say what they offer", text: "Each business writes its own profile, chooses the services it shows and lists the places it works. It appears only while it has its listing published." },
              { title: "Customers say how it went", text: "A rating counts only reviews that customers chose to make public, shown under a first name and last initial." },
            ].map((point) => (
              <div key={point.title} className={cn("rounded-card border border-line bg-surface p-5 shadow-card")}>
                <h3 className="text-base font-bold text-ink">{point.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{point.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link prefetch={false} href="/marketplace" className={buttonClasses({ variant: "primary", size: "lg" })}>
              Find a Service
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
        </Band>
      </main>

      <PublicFooter />
    </div>
  );
}
