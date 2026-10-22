import Link from "next/link";
import type { AppHref } from "@/config/routes";
import { buttonClasses } from "@/components/ui/Button";

type MobileBookBarProps =
  | {
      /** One Service is the one to book (the visitor was looking at it, or it is the only one offered online): the bar books it. */
      href: AppHref;
      /** The words of the Service's booking mode: "Book a time", "Request appointment" or "Request a quote". */
      action: string;
      serviceName: string;
      detail: string;
    }
  | {
      /** Several Services are offered and none is chosen: the bar says so and takes the visitor to the list. */
      href?: undefined;
      action?: undefined;
      serviceName?: undefined;
      detail?: undefined;
    };

/**
 * On a phone the way to book stays on screen while a provider's profile is read: a bar along the bottom with the one action that fits. It is a plain link,
 * so it works without scripting, and it names the booking mode of the Service (a request is "Request appointment", never "Book" or "Confirm"). It is for phones
 * only: from the medium width up the profile has room for its own buttons. The page leaves room under its content (`pb-24`) so the bar never covers any of it.
 */
export function MobileBookBar(props: MobileBookBarProps) {
  return (
    <section
      aria-label="Book this provider"
      className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-overlay md:hidden"
    >
      {props.href ? (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{props.serviceName}</p>
            <p className="truncate text-xs text-ink-muted">{props.detail}</p>
          </div>
          <Link href={props.href} prefetch={false} className={buttonClasses({ size: "md", className: "shrink-0" })}>
            {props.action}
            <span className="sr-only"> {props.serviceName}</span>
          </Link>
        </>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-sm font-semibold text-ink">Choose a service to book</p>
          <a href="#services" className={buttonClasses({ size: "md", className: "shrink-0" })}>
            See services
          </a>
        </>
      )}
    </section>
  );
}
