/**
 * Phase 18C1: what a production deployment's environment must look like (src/lib/deployment.ts), as pure functions. The application refuses to
 * start on any of these (src/instrumentation.ts), and `npm run config:check` and the deploy script apply the same rules to the env file before
 * anything is built or started. Nothing here touches a database, the network or a file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { describeConfigProblems, isProductionDeployment, productionConfigProblems } from "../src/lib/deployment";
import { ROOT, SRC } from "./import-graph";

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** An environment that is fit for a production deployment; each test spoils one thing. */
const GOOD: Record<string, string> = {
  CLIMVIA_ENV: "production",
  NODE_ENV: "production",
  DATABASE_URL: "postgres://climvia_app:Zk3pQ9vLw2XnR7sTb4Yc@db:5432/climvia",
  BETTER_AUTH_SECRET: "k9Fh2Lw7QxPz4VnR8sTb3YcJd6MeUa1G",
  BETTER_AUTH_URL: "https://app.climvia.example",
  AUTH_TRUSTED_PROXIES: "172.30.0.0/24",
  APP_HOSTS: "app.climvia.example",
  CUSTOM_DOMAIN_TARGET: "sites.climvia.example",
  TLS_ASK_TOKEN: "Qm7Vx2Lp9Rk4Zt6Wc1Hb8NsDf3Ya5JgE",
  ASSET_STORAGE_DRIVER: "local",
  ASSET_LOCAL_DIR: "/data/assets",
};

const without = (...names: string[]) => Object.fromEntries(Object.entries(GOOD).filter(([name]) => !names.includes(name)));
const problemsWith = (changes: Record<string, string | undefined>) => productionConfigProblems({ ...GOOD, ...changes });
const about = (problems: string[], name: string) => problems.filter((problem) => problem.startsWith(`${name} `));

test.describe("the marker", () => {
  test("only CLIMVIA_ENV=production makes the rules apply: a production build with test settings (the browser tests) is not a deployment", () => {
    expect(isProductionDeployment({ CLIMVIA_ENV: "production" })).toBe(true);
    for (const env of [{}, { NODE_ENV: "production" }, { CLIMVIA_ENV: "development" }, { CLIMVIA_ENV: "Production" }, { CLIMVIA_ENV: " production" }]) {
      expect(isProductionDeployment(env), JSON.stringify(env)).toBe(false);
      expect(productionConfigProblems({ ...env, DOMAIN_DNS_RESOLVER: "fixture", DATABASE_ADMIN_URL: "postgres://owner:x@h/db" })).toEqual([]);
    }
  });

  test("a good environment has no problems", () => {
    expect(productionConfigProblems(GOOD)).toEqual([]);
  });
});

test.describe("what the application connects as", () => {
  test("it must be the restricted runtime role, with a real password, on a postgres URL", () => {
    expect(about(productionConfigProblems(without("DATABASE_URL")), "DATABASE_URL")).toHaveLength(1);
    for (const url of [
      "postgres://climvia_owner:Zk3pQ9vLw2XnR7sTb4Yc@db:5432/climvia",
      "postgres://postgres:Zk3pQ9vLw2XnR7sTb4Yc@db:5432/climvia",
      "postgres://climvia_app@db:5432/climvia",
      "postgres://climvia_app:change-me@db:5432/climvia",
      "postgres://climvia_app:replace-with-a-password@db:5432/climvia",
      "mysql://climvia_app:Zk3pQ9vLw2XnR7sTb4Yc@db:3306/climvia",
      "not a url",
    ]) {
      expect(about(problemsWith({ DATABASE_URL: url }), "DATABASE_URL"), url).toHaveLength(1);
    }
    expect(about(problemsWith({ DATABASE_URL: "postgresql://climvia_app:Zk3pQ9vLw2XnR7sTb4Yc@db:5432/climvia" }), "DATABASE_URL")).toEqual([]);
  });

  test("the owner's credential and long-lived AWS keys are never in the application's environment", () => {
    for (const name of ["DATABASE_ADMIN_URL", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
      expect(about(problemsWith({ [name]: "anything" }), name), name).toHaveLength(1);
    }
  });

  test("the pool size, when given, is a whole number", () => {
    expect(about(problemsWith({ DATABASE_POOL_MAX: "10" }), "DATABASE_POOL_MAX")).toEqual([]);
    for (const value of ["0", "-1", "ten", "1.5", "1000"]) expect(about(problemsWith({ DATABASE_POOL_MAX: value }), "DATABASE_POOL_MAX"), value).toHaveLength(1);
  });
});

test.describe("sign-in and addresses", () => {
  test("the sign-in secret is long, not a placeholder and not one repeated character", () => {
    expect(about(productionConfigProblems(without("BETTER_AUTH_SECRET")), "BETTER_AUTH_SECRET")).toHaveLength(1);
    for (const secret of ["short", "a".repeat(40), "replace-with-a-long-random-string-of-32-chars", "change-me-change-me-change-me-change-me", "Your-secret-goes-here-0123456789abcdef"]) {
      expect(about(problemsWith({ BETTER_AUTH_SECRET: secret }), "BETTER_AUTH_SECRET"), secret).toHaveLength(1);
    }
  });

  test("the public address is an https origin on a domain name", () => {
    expect(about(productionConfigProblems(without("BETTER_AUTH_URL")), "BETTER_AUTH_URL")).toHaveLength(1);
    for (const url of ["http://app.climvia.example", "https://app.climvia.example/login", "https://app.climvia.example/?x=1", "https://127.0.0.1", "https://localhost", "https://user:pw@app.climvia.example", "app.climvia.example", ""]) {
      expect(about(problemsWith({ BETTER_AUTH_URL: url }), "BETTER_AUTH_URL"), url).toHaveLength(1);
    }
    expect(about(problemsWith({ BETTER_AUTH_URL: "https://app.climvia.example:8443" }), "BETTER_AUTH_URL")).toEqual([]);
  });

  test("the reverse proxy is named, as addresses or ranges, so rate limits see real clients", () => {
    expect(about(productionConfigProblems(without("AUTH_TRUSTED_PROXIES")), "AUTH_TRUSTED_PROXIES")).toHaveLength(1);
    expect(about(problemsWith({ AUTH_TRUSTED_PROXIES: "  " }), "AUTH_TRUSTED_PROXIES")).toHaveLength(1);
    expect(about(problemsWith({ AUTH_TRUSTED_PROXIES: "caddy" }), "AUTH_TRUSTED_PROXIES")).toHaveLength(1);
    expect(about(problemsWith({ AUTH_TRUSTED_PROXIES: "172.30.0.2, 10.0.0.0/8, ::1" }), "AUTH_TRUSTED_PROXIES")).toEqual([]);
  });

  test("extra trusted origins are https only", () => {
    expect(about(problemsWith({ AUTH_TRUSTED_ORIGINS: "http://other.example" }), "AUTH_TRUSTED_ORIGINS")).toHaveLength(1);
    expect(about(problemsWith({ AUTH_TRUSTED_ORIGINS: "nonsense" }), "AUTH_TRUSTED_ORIGINS")).toHaveLength(1);
    expect(about(problemsWith({ AUTH_TRUSTED_ORIGINS: "https://other.example" }), "AUTH_TRUSTED_ORIGINS")).toEqual([]);
  });
});

test.describe("names and certificates", () => {
  test("the routing target is a domain name other than the application's own address", () => {
    expect(about(productionConfigProblems(without("CUSTOM_DOMAIN_TARGET")), "CUSTOM_DOMAIN_TARGET")).toHaveLength(1);
    expect(about(problemsWith({ CUSTOM_DOMAIN_TARGET: "10.0.0.1" }), "CUSTOM_DOMAIN_TARGET")).toHaveLength(1);
    expect(about(problemsWith({ CUSTOM_DOMAIN_TARGET: "app.climvia.example" }), "CUSTOM_DOMAIN_TARGET")).toHaveLength(1);
  });

  test("the platform's own hosts are domain names, and the customers' scheme can only be https", () => {
    expect(about(problemsWith({ APP_HOSTS: "app.climvia.example, 10.0.0.1" }), "APP_HOSTS")).toHaveLength(1);
    expect(about(problemsWith({ CUSTOM_DOMAIN_URL_SCHEME: "http" }), "CUSTOM_DOMAIN_URL_SCHEME")).toHaveLength(1);
    expect(about(problemsWith({ CUSTOM_DOMAIN_URL_SCHEME: "https" }), "CUSTOM_DOMAIN_URL_SCHEME")).toEqual([]);
  });

  test("the certificate-permission endpoint has a secret of its own, strong and not a placeholder", () => {
    expect(about(productionConfigProblems(without("TLS_ASK_TOKEN")), "TLS_ASK_TOKEN")).toHaveLength(1);
    for (const token of ["short", "x".repeat(40), "change-me-change-me-change-me-change-me", "replace-this-token-0123456789"]) {
      expect(about(problemsWith({ TLS_ASK_TOKEN: token }), "TLS_ASK_TOKEN"), token).toHaveLength(1);
    }
  });
});

test.describe("where uploaded files go", () => {
  test("a driver is chosen on purpose, and the local one points at the mounted volume", () => {
    expect(about(productionConfigProblems(without("ASSET_STORAGE_DRIVER")), "ASSET_STORAGE_DRIVER")).toHaveLength(1);
    expect(about(problemsWith({ ASSET_STORAGE_DRIVER: "ftp" }), "ASSET_STORAGE_DRIVER")).toHaveLength(1);
    expect(about(productionConfigProblems(without("ASSET_LOCAL_DIR")), "ASSET_LOCAL_DIR")).toHaveLength(1);
    for (const directory of [".data/assets", "relative/path", "/srv/app/.data/assets", "/tmp/assets-test"]) {
      expect(about(problemsWith({ ASSET_LOCAL_DIR: directory }), "ASSET_LOCAL_DIR"), directory).toHaveLength(1);
    }
  });

  test("the S3 driver needs a real region and bucket, and no static AWS key", () => {
    const s3 = { ASSET_STORAGE_DRIVER: "s3", ASSET_LOCAL_DIR: undefined, AWS_REGION: "us-east-1", AWS_S3_BUCKET: "climvia-assets-prod" };
    expect(problemsWith(s3)).toEqual([]);
    expect(about(problemsWith({ ...s3, AWS_REGION: undefined }), "AWS_REGION")).toHaveLength(1);
    expect(about(problemsWith({ ...s3, AWS_REGION: "mars" }), "AWS_REGION")).toHaveLength(1);
    expect(about(problemsWith({ ...s3, AWS_S3_BUCKET: undefined }), "AWS_S3_BUCKET")).toHaveLength(1);
    expect(about(problemsWith({ ...s3, AWS_S3_BUCKET: "Not_A_Bucket" }), "AWS_S3_BUCKET")).toHaveLength(1);
    expect(about(problemsWith({ ...s3, AWS_ACCESS_KEY_ID: "AKIAEXAMPLE" }), "AWS_ACCESS_KEY_ID")).toHaveLength(1);
  });
});

test.describe("nothing that exists only for development and tests", () => {
  test("the test DNS resolver, its answer directory, the test directories, the seed switches and the seed password are refused", () => {
    expect(about(problemsWith({ DOMAIN_DNS_RESOLVER: "fixture" }), "DOMAIN_DNS_RESOLVER")).toHaveLength(1);
    expect(about(problemsWith({ DOMAIN_DNS_RESOLVER: "system" }), "DOMAIN_DNS_RESOLVER")).toEqual([]);
    for (const name of ["DOMAIN_DNS_FIXTURE_DIR", "TEST_ASSET_DIR", "TEST_DNS_DIR", "TEST_DATABASE_NAME", "ALLOW_SEED", "SEED_PASSWORD"]) {
      expect(about(problemsWith({ [name]: "1" }), name), name).toHaveLength(1);
    }
  });

  test("NODE_ENV must be production as well", () => {
    expect(about(problemsWith({ NODE_ENV: "development" }), "NODE_ENV")).toHaveLength(1);
  });
});

test.describe("the report", () => {
  test("names each problem and its rule, and never a value", () => {
    const secret = "Sup3rS3cretValue-that-must-not-leak-9X";
    const problems = problemsWith({ DATABASE_URL: `postgres://climvia_owner:${secret}@db/x`, BETTER_AUTH_SECRET: "short", AWS_SECRET_ACCESS_KEY: secret, TLS_ASK_TOKEN: secret.slice(0, 8) });
    const report = describeConfigProblems(problems);
    expect(report).toContain(`${problems.length} problems`);
    expect(report).toContain("DATABASE_URL");
    expect(report).not.toContain(secret);
    expect(report).not.toContain("climvia_owner:");
    expect(describeConfigProblems(["X is wrong."])).toContain("1 problem)");
  });

  test("a good environment collects every problem at once, not only the first", () => {
    const spoiled = productionConfigProblems({ CLIMVIA_ENV: "production", NODE_ENV: "production" });
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "AUTH_TRUSTED_PROXIES", "CUSTOM_DOMAIN_TARGET", "TLS_ASK_TOKEN", "ASSET_STORAGE_DRIVER"]) {
      expect(about(spoiled, name), name).toHaveLength(1);
    }
  });
});

test.describe("where the rules are applied", () => {
  test("the instrumentation hook applies them before the first request, and the process EXITS on any problem (a thrown error would leave a half-started server running)", () => {
    const hook = stripComments(readFileSync(join(SRC, "instrumentation.ts"), "utf8"));
    // Only in the Node runtime: the edge runtime has no process environment to check, and no process to exit.
    expect(hook).toContain('process.env.NEXT_RUNTIME !== "nodejs"');
    expect(hook).toContain("refuseToStartOnBadConfiguration()");
    expect(hook).not.toContain("process.exit");
    const node = stripComments(readFileSync(join(SRC, "instrumentation-node.ts"), "utf8"));
    expect(node).toContain("productionConfigProblems()");
    expect(node).toContain("describeConfigProblems(problems)");
    expect(node).toContain("process.exit(1)");
    expect(node).not.toContain("throw ");
  });

  test("the rules module is pure: no database, no network, no file, no server-only import", () => {
    const source = stripComments(readFileSync(join(SRC, "lib", "deployment.ts"), "utf8"));
    expect(source).not.toMatch(/from "(node:fs|node:net|node:http|pg|@\/db|server-only)/);
    expect(source).not.toMatch(/\bfetch\(|process\.env\./);
  });

  test("the config check script reads a file and applies the same function, and prints no value", () => {
    const script = stripComments(readFileSync(join(ROOT, "scripts", "check-config.ts"), "utf8"));
    expect(script).toContain("productionConfigProblems(");
    expect(script).toContain("describeConfigProblems(application)");
    expect(script).toContain("deploymentFileProblems(parsed)");
    // It validates exactly what the app container will receive, not the whole file (the owner's password is in the file, never in the app).
    expect(script).toContain("applicationEnvironmentOf(parsed)");
    expect(script).not.toMatch(/console\.(log|error)\([^)]*parsed/);
  });
});
