import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { CustomerReviewForm } from "@/components/reviews/CustomerReviewForm";
import { getReviewLink } from "@/server/public-site";

/**
 * The page a customer opens from the link a business gave them, to rate the work and write a review. The address holds a secret: it is looked up by its
 * hash, it names the business and the customer only through that lookup, and a wrong or unknown one is the same plain "not found" as any other address.
 *
 * Because the address is a secret it is kept out of everything that could copy it: the page is never indexed or followed, never cached (it is dynamic),
 * and sends no Referer when a visitor follows a link off it. No session is read and no workspace is mounted; the customer needs no account.
 */
export const metadata: Metadata = {
  title: "Write a review",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: PageProps<"/review/[token]">) {
  const { token } = await params;
  const link = await getReviewLink(token);
  if (!link) notFound();

  return (
    <div className="flex min-h-dvh flex-col items-center bg-canvas px-4 py-10">
      <Link href="/" aria-label="Climvia" className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-btn bg-primary text-lg font-bold tracking-tight text-white shadow-card">
          C
        </span>
        <span className="text-xl font-bold tracking-tight text-ink">Climvia</span>
      </Link>
      <main className="mt-8 w-full max-w-xl">
        <Card>
          {link.state === "open" ? (
            <>
              <p className="text-micro font-semibold tracking-wider text-ink-muted uppercase">A review for {link.business}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">How did {link.business} do?</h1>
              <p className="mt-1 text-sm text-ink-muted">Rate the work and tell {link.business} how it went. It takes a minute, and you don&apos;t need an account.</p>
              <div className="mt-6">
                <CustomerReviewForm token={token} business={link.business} displayName={link.displayName} />
              </div>
            </>
          ) : link.state === "completed" ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-ink">This review has already been sent</h1>
              <p className="mt-2 text-sm text-ink-muted">Each review link works once, and this one was used. Thank you for your feedback to {link.business}.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-ink">This review link has expired</h1>
              <p className="mt-2 text-sm text-ink-muted">Review links stop working after a while. Ask {link.business} for a new one if you still want to leave a review.</p>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
