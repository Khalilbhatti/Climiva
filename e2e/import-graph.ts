/**
 * The import graph of the source tree, for the specs that hold a boundary in the code rather than in a browser
 * (provider-boundary.spec.ts, tenant-fixture-boundary.spec.ts).
 *
 * A file's imports are the modules it brings in at run time: type-only imports are erased by the compiler, so they bring in nothing, and
 * comments are not code. Specifiers are resolved the way the build resolves them (`@/` is `src/`, relative paths from the importing
 * file); packages are not followed. A relative import that leaves `src/` (to `scripts/` or `e2e/`) is followed too, which is how a
 * file under `src/` reaching seed or test code is seen.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const ROOT = process.cwd();
export const SRC = join(ROOT, "src");
export const posix = (path: string) => relative(ROOT, path).split(sep).join("/");

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(from), specifier) : undefined;
  if (!base) return undefined;
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/** The modules a file brings in at run time (type-only imports are erased, so they bring in nothing). */
export function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const specifiers: string[] = [];
  for (const match of code.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/g)) if (!match[1]) specifiers.push(match[2]);
  for (const match of code.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specifiers.push(match[1]);
  return specifiers.flatMap((specifier) => resolveImport(file, specifier) ?? []);
}

/**
 * Every source file reachable from `entries`, each with the file that first brought it in (to say how a forbidden one got there).
 * A file for which `follow` answers false is reached but not entered: it is a boundary the graph does not cross (a Server Action, which
 * a Client Component calls but never bundles).
 */
export function reachable(entries: string[], follow: (file: string) => boolean = () => true): Map<string, string | undefined> {
  const seen = new Map<string, string | undefined>(entries.map((entry) => [entry, undefined]));
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!follow(file)) continue;
    for (const next of importsOf(file)) {
      if (seen.has(next)) continue;
      seen.set(next, file);
      queue.push(next);
    }
  }
  return seen;
}

export const chainOf = (seen: Map<string, string | undefined>, file: string): string => {
  const chain: string[] = [];
  for (let current: string | undefined = file; current; current = seen.get(current)) chain.unshift(posix(current));
  return chain.join(" -> ");
};
