import Link from "next/link";

/**
 * The "couldn't find that page" state with no workspace, no session and no data behind it: the same words for an address that does not exist,
 * a website or listing that is private or unknown, and a page that is hidden, so it reveals nothing about any of them (or about anyone's account).
 */
export function PlainNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <h1 className="text-xl font-bold text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">The link may be incorrect.</p>
      <Link href="/" className="mt-5 text-sm font-semibold text-primary hover:underline">
        Go to Climvia
      </Link>
    </main>
  );
}
