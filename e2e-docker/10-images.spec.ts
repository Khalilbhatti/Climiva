/**
 * Docker side, part 10: what is INSIDE the images the release candidate ships, looked at from outside them.
 *
 * The web image (what runs) and the tools image (what migrates and grants) are searched for what must never be in an image: environment files, database
 * dumps, test reports and traces, uploaded files, the sample businesses, this stack's own secrets, a review link's secret, cloud credentials and private keys,
 * and Git metadata. Their configuration is read: a non-root user, only the settings the application needs, no secret in the image's environment or history.
 * The running container is read-only, has no capabilities, and can use `sharp`.
 *
 * Nothing is extracted to the host: each search runs in a throwaway container of the image itself (read-only, no network).
 */
import { readFileSync } from "node:fs";
import { expect, test } from "playwright/test";
import { compose, docker, stack } from "./stack";

test.describe.configure({ mode: "serial", timeout: 300_000 });

const version = process.env.APP_VERSION ?? "local";
const IMAGES = { web: `climvia-web:${version}`, tools: `climvia-tools:${version}` } as const;
let release: { usedLinks: string[]; activeLink: string };

test.beforeAll(() => {
  release = JSON.parse(readFileSync(".data/docker-release.json", "utf8"));
});

/** Run a shell script in a throwaway, read-only, network-less container of the image. */
function inside(image: string, script: string): { code: number; out: string } {
  return docker("run", "--rm", "--network", "none", "--read-only", "--entrypoint", "sh", image, "-c", script);
}

for (const [kind, image] of Object.entries(IMAGES)) {
  test.describe(`the ${kind} image`, () => {
    test("it exists, was built from this commit, and is not run as root", async () => {
      const inspected = JSON.parse(docker("image", "inspect", image).out)[0] as { Config: { User: string; Env: string[]; Labels?: Record<string, string>; Entrypoint?: string[] | null }; Size: number };
      // The web image carries the commit it was built from in its label; the tools image is the same commit by its tag.
      if (kind === "web") expect(inspected.Config.Labels?.["org.opencontainers.image.revision"], "the build's revision label").toBe(version);
      if (kind === "web") expect(inspected.Config.User).toBe("10001:10001");
      else expect(inspected.Config.User).toBe("node");
      // Its environment holds the application's fixed switches and nothing a person typed: no password, URL, key, token or secret.
      const names = inspected.Config.Env.map((entry) => entry.split("=")[0]);
      for (const forbidden of ["DATABASE_URL", "DATABASE_ADMIN_URL", "BETTER_AUTH_SECRET", "TLS_ASK_TOKEN", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "SEED_PASSWORD", "ALLOW_SEED", "DOMAIN_DNS_RESOLVER"]) expect(names, forbidden).not.toContain(forbidden);
      expect(inspected.Config.Env.join("\n")).not.toMatch(/postgres(ql)?:\/\/|password|secret|token/i);
      expect(inspected.Size).toBeGreaterThan(50_000_000);
    });

    test("its history (every build step) names no secret and copies no environment file", async () => {
      const history = docker("history", "--no-trunc", "--format", "{{.CreatedBy}}", image).out;
      expect(history).not.toMatch(/\.env(\.|\s|$)|\.trial|\.production|BETTER_AUTH_SECRET=|TLS_ASK_TOKEN=|PASSWORD=|AWS_(ACCESS|SECRET)|postgres:\/\/\w+:\w+@/i);
      // The sample-data command's files are not copied in.
      expect(history).not.toMatch(/seed-data|seed-lib|scripts\/db\/seed/);
    });

    test("it holds no environment file, dump, report, trace, upload, Git metadata, editor setting or reference design", async () => {
      const found = inside(image, `find / -xdev \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o \\( -name '.env' -o -name '.env.*' -o -name '*.dump' -o -name '*.dump.sha256' -o -name '*.assets.tar.gz' -o -name 'playwright-report' -o -name 'test-results' -o -name 'trace.zip' -o -name '*.trace' -o -name '.git' -o -name '.claude' -o -name 'design-reference' -o -name '.data' -o -name 'backups' -o -name 'e2e' -o -name 'e2e-docker' -o -name '.aws' -o -name '.npmrc' -o -name 'id_rsa' -o -name 'id_ed25519' -o -name '.pgpass' \\) -print 2>/dev/null | grep -v '/node_modules/' | head -50`);
      expect(found.code, found.out).toBe(0);
      const hits = found.out.split(/\r?\n/).filter((line) => line.trim() !== "");
      // The one allowed: the example environment file is documentation and is not copied; nothing may remain, so the list is empty.
      expect(hits).toEqual([]);
      // The docs, the tests and the deploy tooling are not part of the application.
      for (const path of ["/app/docs", "/app/e2e", "/app/e2e-docker", "/app/deploy", "/app/.git", "/app/README.md", "/app/playwright.config.ts"]) {
        expect(inside(image, `test -e ${path}`).code, path).not.toBe(0);
      }
    });

    test("it holds no uploaded file and no database dump: a business's data lives on volumes, never in an image", async () => {
      if (kind === "web") {
        const assets = inside(image, "find /data -type f 2>/dev/null | wc -l");
        expect(assets.out.trim()).toBe("0");
      }
      const dumps = inside(image, "find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -type f \\( -name '*.dump' -o -name '*.pgdump' -o -name '*.bak' -o -name '*.backup' \\) -print 2>/dev/null | head -5");
      expect(dumps.out.trim()).toBe("");
    });

    test("it holds no sample business: nothing of Apex or Northstar, in the files or the compiled code", async () => {
      // No sample-data module or file in either image.
      const files = inside(image, "find /app -type f \\( -iname '*seed*' -o -iname '*apex*' -o -iname '*northstar*' \\) 2>/dev/null | grep -v '/node_modules/' | head -20");
      expect(files.out.trim().split(/\r?\n/).filter(Boolean)).toEqual([]);
      // The web image, which runs, holds no sample business in any file or in the compiled code. (The tools image carries the source and the migrations, whose
      // comments use a business's name as an example; that is documentation, not data, and no seed module is there.)
      if (kind === "web") {
        const hits = inside(image, "grep -rIlE 'apex-climate-heating-air|northstar-heating-cooling|apexclimate|Sarah Mitchell|Alex Morgan|Jamie Rivera' /app 2>/dev/null | grep -v '/node_modules/' | head -20");
        expect(hits.out.trim().split(/\r?\n/).filter(Boolean)).toEqual([]);
      }
    });

    test("it holds none of this stack's own secrets, no review link's secret, no cloud credential and no private key outside the libraries' own tests", async () => {
      const secrets = ["BETTER_AUTH_SECRET", "TLS_ASK_TOKEN", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD"].map((name) => stack.env[name]).filter((value): value is string => Boolean(value) && String(value).length >= 12);
      expect(secrets.length).toBeGreaterThan(0);
      const patterns = [...secrets, ...release.usedLinks.map((link) => link.split("/").pop() ?? ""), (release.activeLink.split("/").pop() ?? "")].filter((value) => value.length >= 12);
      const fixed = inside(image, `grep -rIlF ${patterns.map((value) => `-e '${value.replace(/'/g, "")}'`).join(" ")} / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev 2>/dev/null | head -5`);
      expect(fixed.out.trim(), "a secret of the stack").toBe("");
      const keys = inside(image, "grep -rIlE 'AKIA[0-9A-Z]{16}|aws_secret_access_key|aws_session_token|-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----' /app 2>/dev/null | grep -v '/node_modules/' | head -5");
      expect(keys.out.trim(), "a credential or key in the application's own files").toBe("");
    });
  });
}

test.describe("the running application container", () => {
  test("it is read-only, drops every capability, cannot gain privilege, and runs as the unprivileged user", async () => {
    const container = compose("ps", "-q", "app").trim();
    const info = JSON.parse(docker("inspect", container).out)[0] as { Config: { User: string }; HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[] | null; CapAdd: string[] | null; SecurityOpt: string[] | null; Privileged: boolean; PidMode: string; NetworkMode: string } };
    expect(info.HostConfig.ReadonlyRootfs).toBe(true);
    expect(info.HostConfig.CapDrop).toContain("ALL");
    expect(info.HostConfig.CapAdd ?? []).toEqual([]);
    expect(info.HostConfig.SecurityOpt ?? []).toContain("no-new-privileges:true");
    expect(info.HostConfig.Privileged).toBe(false);
    expect(info.Config.User).toBe("10001:10001");
    // Nothing is published by the application itself: the proxy is the only listener.
    const ports = JSON.parse(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", container).out.trim()) as Record<string, unknown>;
    expect(Object.values(ports).filter((binding) => binding !== null)).toEqual([]);
  });

  test("`sharp` works in the final container: it re-encodes an image to WebP on the read-only filesystem", async () => {
    const answer = compose(
      "exec", "-T", "app", "node", "-e",
      "const sharp = require('sharp'); sharp({ create: { width: 64, height: 40, channels: 3, background: { r: 13, g: 92, b: 99 } } }).png().toBuffer().then((png) => sharp(png).webp({ quality: 80 }).toBuffer()).then((webp) => console.log(JSON.stringify({ riff: webp.subarray(0, 4).toString('latin1'), webp: webp.subarray(8, 12).toString('latin1'), libvips: Boolean(sharp.versions.vips) })))",
    );
    expect(JSON.parse(answer.trim().split(/\r?\n/).pop() ?? "{}")).toEqual({ riff: "RIFF", webp: "WEBP", libvips: true });
  });

  test("it carries no demo setting and no test switch, and reports itself as the commit that was built", async () => {
    const environment = compose("exec", "-T", "app", "env").split(/\r?\n/).map((line) => line.split("=")[0]);
    for (const forbidden of ["ALLOW_SEED", "SEED_PASSWORD", "DOMAIN_DNS_RESOLVER", "DOMAIN_DNS_FIXTURE_DIR", "TEST_ASSET_DIR", "TEST_DNS_DIR", "TEST_DATABASE_NAME"]) expect(environment, forbidden).not.toContain(forbidden);
    expect(compose("exec", "-T", "app", "printenv", "APP_VERSION").trim()).toBe(version);
    expect(compose("exec", "-T", "app", "printenv", "CUSTOM_DOMAIN_URL_SCHEME").trim()).toBe("https");
  });
});
