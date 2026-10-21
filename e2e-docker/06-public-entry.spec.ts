/**
 * Docker side, part 6: the public front door in the production-shaped stack (Phase 19C).
 *
 *   - `/` on the platform's own address is Climvia's public landing for a visitor with no session, through the proxy;
 *   - a review link's address IS its secret, so the proxy's access log writes `/review/<secret>` as `/review/REDACTED`, in the request address and in a
 *     Referer that carries it, and neither the proxy's log nor the application's ever holds the secret (a secret that is not a link answers the plain not-found).
 *
 * It needs only a running stack; it signs nobody in and writes nothing to the database.
 */
import { randomBytes } from "node:crypto";
import { expect, test } from "playwright/test";
import { compose, get, stack } from "./stack";

const logs = (service: string) => compose("logs", "--no-log-prefix", "--tail", "400", service);

test("the platform's address answers a visitor with Climvia's landing: two doors and a sign-in, no workspace", async () => {
  const home = await get(stack.publicHost, "/");
  expect(home.status).toBe(200);
  expect(home.body).toContain("Find HVAC services");
  expect(home.body).toContain("Run your HVAC business with Climvia");
  expect(home.body).toMatch(/href="\/marketplace"/);
  expect(home.body).toMatch(/href="\/signup"/);
  expect(home.body).toMatch(/href="\/login"/);
  expect(String(home.headers["set-cookie"] ?? "")).toBe("");
  expect(home.body).not.toMatch(/What needs your attention today|better-auth|organizationId|"session"/i);
});

test("a review link is kept out of the proxy's log, in the address and in a Referer, and out of the application's log", async () => {
  const secret = randomBytes(32).toString("base64url");
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const opened = await get(stack.publicHost, `/review/${secret}`, { headers: { referer: `${stack.origin}/review/${secret}` } });
  // Nothing holds this secret, so it is the same plain "not found" as any other address, with no session set. (The page's own payload names the address
  // that was asked for, as any not-found page does; that is the asker's own request coming back to them, so it is the LOGS that are checked below.)
  expect(opened.status).toBe(404);
  expect(String(opened.headers["set-cookie"] ?? "")).toBe("");

  // The log line is written when the response ends; give the container a moment to hand it to `docker logs`.
  let proxy = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    proxy = logs("proxy");
    if (proxy.includes("/review/REDACTED")) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(proxy, "the request was logged with the secret replaced").toContain("/review/REDACTED");
  expect(proxy, "the secret itself is not in the proxy's log").not.toContain(secret);
  expect(logs("app"), "the application never logs it either").not.toContain(secret);
});
