"use client";

/**
 * The last resort, shown when the root layout itself cannot render (the database is unreachable, for example). It replaces
 * the whole document, so it carries its own minimal styling. It says what happened in plain words and never falls back to
 * showing anyone's workspace or sample data.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fbf9f3", color: "#1f2937", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "1rem" }}>
        <main>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>We couldn&apos;t load Climvia</h1>
          <p style={{ marginTop: "0.5rem", color: "#5a687d" }}>Something went wrong on our side, and nothing was changed. Try again in a moment.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: "1.25rem", padding: "0.6rem 1.1rem", border: 0, borderRadius: "0.5rem", background: "#0d5c63", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
