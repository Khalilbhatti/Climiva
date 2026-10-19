import { ShieldAlert } from "lucide-react";

/**
 * Told to a business whose Marketplace listing the platform has suspended. It says THAT, and what it means, and nothing else: the reason the
 * platform recorded is never shown to the business (and is not even sent to its pages). What the business entered stays saved; it can still edit it.
 * Publishing again does not make the listing public while the suspension stands, and when it is lifted the listing is public again only if the
 * business has it published.
 */
export function SuspendedNotice({ published }: { published: boolean }) {
  return (
    <section aria-labelledby="suspended-heading" role="status" className="flex items-start gap-3 rounded-card border border-danger-line bg-danger-soft p-4 text-danger">
      <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>
        <h2 id="suspended-heading" className="text-sm font-semibold">
          Climvia has suspended your Marketplace listing
        </h2>
        <p className="mt-1 text-sm">
          Customers can&apos;t find your listing, open it or book from it while it is suspended. Your listing content is saved
          {published ? " and it is still set to published, so it will be visible again when Climvia lifts the suspension." : ". Publishing it will not make it public until Climvia lifts the suspension."}
        </p>
      </div>
    </section>
  );
}
