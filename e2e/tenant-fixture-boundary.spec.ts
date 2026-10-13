/**
 * A business's sample records never reach a browser, held three ways: in the import graph, in the source, and in what the build ships.
 *
 * Apex Climate Heating & Air and Northstar Heating & Cooling are seed and test data. The seed writes their records to PostgreSQL; the
 * application reads a business's values from its own rows (a signed-in business) or from the public projection of them (a visitor),
 * never from a constant. So no module a Client Component imports, directly or through any chain, may be a seed, test or tenant-fixture
 * module; no file under src/ may import one at all; no business's values may be written into the source the build starts from; and the
 * client JavaScript the production build emits must not contain them. The last is checked by reading the emitted files, not by trusting
 * any of the first three: an import nobody foresaw, or a copied string, still shows up there.
 *
 * (tenant-fixture-runtime.spec.ts checks the same at run time, in a browser, for Apex, Northstar and a business that has just been set up.)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { ROOT, SRC, chainOf, importsOf, posix, reachable, walk } from "./import-graph";
import { BUSINESS_VALUES, SAMPLE_WORKSPACE_VALUES, foundIn } from "./tenant-values";

const read = (file: string) => readFileSync(file, "utf8");
/** The code of a file: comments are not shipped, so they are not looked at. */
const codeOf = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const isClientFile = (file: string) => /^\s*(["'])use client\1/.test(read(file).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));

const sourceFiles = walk(SRC);
const clientFiles = sourceFiles.filter(isClientFile);

/** A Server Action is called by a Client Component but never bundled into it, so the graph stops there. */
const isServerAction = (file: string) => posix(file).startsWith("src/server/actions/");

/**
 * What no Client Component may bring in, however far down: seed data and tests, the server (its actions aside), the sample workspace's
 * server-side branding, and the sample workspace's pinned clock (a browser is given the clock to use by the workspace, `useClock()`).
 */
const NOT_FOR_BROWSERS = [/^scripts\//, /^e2e\//, /^src\/server\/(?!actions\/)/, /^src\/lib\/prototype-clock\.ts$/, /^src\/data\/fixtures\.ts$/];

test.describe("the import graph", () => {
  test("there are Client Components to hold to it, and the graph sees the edges that matter", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    // Controls: seed and test code do import the Apex record, and the walker resolves it. If it could not, "nothing in src imports it" would
    // be true of anything.
    const apex = join(ROOT, "scripts", "db", "seed-data", "apex.ts");
    expect(importsOf(join(ROOT, "scripts", "db", "seed-lib.ts"))).toContain(apex);
    expect(importsOf(join(ROOT, "e2e", "settings-data.spec.ts"))).toContain(apex);
    // And a Client Component's chain is followed: a settings form reaches the shared lists in data/settings and the formatters in lib.
    const form = reachable([join(SRC, "components", "settings", "BusinessInformationForm.tsx")], (file) => !isServerAction(file));
    expect([...form.keys()].map(posix)).toEqual(expect.arrayContaining(["src/data/settings.ts", "src/lib/format.ts"]));
  });

  test("nothing a Client Component imports, directly or through any chain, is seed, test, server-only or sample-workspace code", () => {
    const seen = reachable(clientFiles, (file) => !isServerAction(file));
    const offenders = [...seen.keys()].filter((file) => !isServerAction(file) && NOT_FOR_BROWSERS.some((pattern) => pattern.test(posix(file)))).map((file) => chainOf(seen, file));
    expect(offenders).toEqual([]);
  });

  test("no file under src imports a seed or test module, so no part of the application can read a business's sample records", () => {
    const offenders = sourceFiles.flatMap((file) => importsOf(file).filter((target) => /^(scripts|e2e)\//.test(posix(target))).map((target) => `${posix(file)} -> ${posix(target)}`));
    expect(offenders).toEqual([]);
  });

  test("the sample records have their one home: the seed, beside Northstar's; the server's branding is marked server-only", () => {
    expect(existsSync(join(SRC, "data", "fixtures.ts"))).toBe(false);
    for (const file of ["apex.ts", "northstar.ts"]) expect(read(join(ROOT, "scripts", "db", "seed-data", file)), file).toMatch(/SEED AND TEST INFRASTRUCTURE ONLY \(nothing in src\/ imports this file/);
    expect(read(join(SRC, "server", "sample-workspace.ts"))).toMatch(/^import "server-only";/);
  });
});

test.describe("the source", () => {
  test("no business's values are written into any file under src, not in the server's code either: they come from the database", () => {
    const hits = sourceFiles.flatMap((file) => foundIn([codeOf(file)], BUSINESS_VALUES).map((hit) => `${posix(file)}: ${hit}`));
    expect(hits).toEqual([]);
  });

  test("what the browser is built from holds neither the sample person, role nor crest", () => {
    const seen = reachable(clientFiles, (file) => !isServerAction(file));
    const hits = [...seen.keys()].flatMap((file) => foundIn([codeOf(file)], SAMPLE_WORKSPACE_VALUES).map((hit) => `${posix(file)}: ${hit}`));
    expect(hits).toEqual([]);
  });
});

test.describe("the production client output", () => {
  const STATIC = join(ROOT, ".next", "static");
  const scripts = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? scripts(join(dir, entry)) : entry.endsWith(".js") ? [join(dir, entry)] : [])) : [];

  test("it is a production build with client JavaScript to look in, and the scan can find a string that is there", () => {
    expect(existsSync(join(ROOT, ".next", "BUILD_ID")), "run `npm run build` first: this reads the client files it emits").toBe(true);
    const files = scripts(STATIC);
    expect(files.length).toBeGreaterThan(20);
    // Control: application copy that is client code (a Settings validation message) is found, so a miss below is a miss.
    expect(foundIn(files.map(read), [{ tenant: "Apex", what: "control", value: "Enter your business name." }])).toHaveLength(1);
  });

  test("no client file contains a business's name, phone, email, street, person, role or the reference crest", () => {
    const hits = scripts(STATIC).flatMap((file) => foundIn([read(file)], [...BUSINESS_VALUES, ...SAMPLE_WORKSPACE_VALUES]).map((hit) => `${posix(file)}: ${hit}`));
    expect(hits).toEqual([]);
  });
});
