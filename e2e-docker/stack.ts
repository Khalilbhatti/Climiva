/**
 * Helpers for the Docker-side tests (playwright.docker.config.ts): where the stack is, how to run a command in it, and how to ask its database
 * a question as the owner. Nothing here publishes a port or reaches around the proxy: the database is asked through `docker compose exec`, the
 * way an operator would.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { connect } from "node:tls";
import { parseEnv } from "node:util";

export type Stack = {
  envFile: string;
  composeFile: string;
  /** https origin of the application, as a browser reaches it. */
  origin: string;
  publicHost: string;
  httpsPort: number;
  httpPort: number;
  /** The domain the application's host lives under (a customer-style name `x.<domain>` is mapped to the stack by the browser). */
  domain: string;
  project: string;
  env: Record<string, string | undefined>;
};

export function dockerStack(): Stack {
  const envFile = process.env.DOCKER_ENV_FILE ?? ".env.trial";
  const env = parseEnv(readFileSync(envFile, "utf8"));
  const publicHost = env.PUBLIC_HOST ?? "";
  const httpsPort = Number(env.HTTPS_PORT ?? 443);
  return {
    envFile,
    composeFile: process.env.DOCKER_COMPOSE_FILE ?? "docker-compose.production.yml",
    origin: `https://${publicHost}${httpsPort === 443 ? "" : `:${httpsPort}`}`,
    publicHost,
    httpsPort,
    httpPort: Number(env.HTTP_PORT ?? 80),
    domain: publicHost.split(".").slice(1).join("."),
    project: env.COMPOSE_PROJECT_NAME ?? "climvia",
    env,
  };
}

export const stack = dockerStack();

/** `docker compose ...` against the stack, returning stdout. Throws (with the command's own output) on a non-zero exit. */
export function compose(...args: string[]): string {
  return execFileSync("docker", ["compose", "-f", stack.composeFile, "--env-file", stack.envFile, ...args], { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
}

/** The same, but never throws: the exit code and the output are the answer (for the tests that expect a failure). */
export function composeResult(...args: string[]): { code: number; out: string } {
  const result = spawnSync("docker", ["compose", "-f", stack.composeFile, "--env-file", stack.envFile, ...args], { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** `docker ...` (not compose). */
export function docker(...args: string[]): { code: number; out: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** One SQL statement (or several, `;`-separated) as the owner, in the database container; rows come back as arrays of strings. */
export function sql(statement: string, database = stack.env.POSTGRES_DB ?? "climvia"): string[][] {
  const out = compose("exec", "-T", "db", "psql", "-U", stack.env.POSTGRES_OWNER_USER ?? "climvia_owner", "-d", database, "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", statement);
  return out.split(/\r?\n/).filter((line) => line !== "").map((line) => line.split("\t"));
}

export const one = (statement: string): string => sql(statement)[0]?.[0] ?? "";

/** The status and body of one request to the proxy with a chosen Host name (resolved to this machine), ignoring certificate errors. */
export function get(host: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string | Buffer; port?: number } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      { host: "127.0.0.1", port: options.port ?? stack.httpsPort, path, method: options.method ?? "GET", servername: host, rejectUnauthorized: false, headers: { host: `${host}${(options.port ?? stack.httpsPort) === 443 ? "" : `:${options.port ?? stack.httpsPort}`}`, ...options.headers }, timeout: 20_000 },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const bytes = Buffer.concat(chunks);
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: bytes.toString("utf8"), bytes });
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("timeout")));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/** A multipart/form-data body (one optional file), the way a browser sends a form. */
export function multipart(fields: Record<string, string>, file?: { field: string; name: string; type: string; bytes: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `----climvia${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  if (file) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** The Cookie header a browser context would send to the stack's own host. */
export async function cookieHeader(context: { cookies: () => Promise<{ name: string; value: string }[]> }): Promise<string> {
  return (await context.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** Whether a TLS handshake for this name (SNI) succeeds, and the certificate's fingerprint if it does. */
export function handshake(host: string, port = stack.httpsPort): Promise<{ ok: true; fingerprint: string; issuer: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port, servername: host, rejectUnauthorized: false, timeout: 15_000 }, () => {
      const certificate = socket.getPeerCertificate();
      resolve({ ok: true, fingerprint: certificate.fingerprint256, issuer: String(certificate.issuer?.CN ?? "") });
      socket.end();
    });
    socket.on("error", (error) => resolve({ ok: false, error: error.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

/** Poll until `check` returns true or the time is up. */
export async function until(check: () => Promise<boolean> | boolean, seconds: number, what: string): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out after ${seconds}s waiting for ${what}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
}
