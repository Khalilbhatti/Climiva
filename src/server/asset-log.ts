import "server-only";

/**
 * The one place the Asset lifecycle writes to the server's log, so what an operator reads is the same everywhere and can be checked in one file.
 *
 * A line says WHAT happened to WHICH Asset of which organization, through which storage driver, with what result: enough to follow an upload from
 * request to ready, or to see why one failed. It never carries the bytes, a file name, a storage key or path, a bucket, a credential, a header or
 * a request body, and the `cause` of a failure is the error's name (a class, not its message, which may quote a path or a bucket).
 */
export function logAsset(event: string, fields: Record<string, string | number | undefined>, level: "info" | "error" = "info"): void {
  const line = `[assets] ${event} ${Object.entries(fields)
    .map(([key, value]) => `${key}=${value ?? "-"}`)
    .join(" ")}`;
  if (level === "error") console.error(line);
  else console.info(line);
}
