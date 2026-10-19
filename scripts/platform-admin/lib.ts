/**
 * Shared by the platform-administrator commands (grant, revoke, list).
 *
 * These commands are the ONLY way platform authority is given or taken away. They connect as the database OWNER (DATABASE_ADMIN_URL), from a
 * terminal on a machine that holds that credential; there is no browser, API or Server Action that writes `platform_admins`. Each change and
 * its audit event are written in one transaction.
 */
import { userInfo } from "node:os";

/** `--email <address>` or `--email=<address>`. Anything else on the command line is refused: a typo should not silently do nothing. */
export function emailFromArguments(argv: readonly string[]): string {
  const args = argv.slice(2);
  let raw: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--email") {
      raw = args[index + 1];
      index += 1;
    } else if (argument.startsWith("--email=")) {
      raw = argument.slice("--email=".length);
    } else {
      throw new UsageError(`Unknown argument "${argument}".`);
    }
  }
  if (raw === undefined) throw new UsageError("Missing --email <address>.");
  return normalizeEmail(raw);
}

/** The one normalization: trimmed and lower-cased, which is how Better Auth stores an address. The lookup is then an exact match. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UsageError("That is not an email address.");
  return email;
}

/** Who ran the command, as the operating system knows them: provenance for the record, not authentication. */
export function operatorLabel(): string {
  let name = "unknown";
  try {
    name = userInfo().username || "unknown";
  } catch {
    // some containers have no passwd entry for the user
  }
  return `cli:${name.replace(/[^A-Za-z0-9._@-]/g, "_").slice(0, 100)}`;
}

/** A mistake in how the command was typed (exit code 1), as opposed to something going wrong (exit code 2). */
export class UsageError extends Error {}
