/**
 * Preloaded by the container (`node --require ./graceful-shutdown.cjs server.js`) so that stopping the application is graceful.
 *
 * The standalone Next.js server does not handle SIGTERM: Node's default action ends the process at once (exit code 143), and a request that was
 * being answered (a logo being saved, a booking being confirmed) is cut off in the middle. `docker stop`, a deployment that recreates the container
 * and an instance shutdown all send SIGTERM first. This stops the server accepting NEW connections, lets the requests already in progress finish,
 * and then exits with success. If they have not finished by the deadline (25 s, inside the 30 s grace period the compose file gives) the remaining
 * connections are closed and the process exits with a failure, so the stop never ends in SIGKILL.
 *
 * It needs no change to the application: it only remembers the HTTP servers the process starts.
 */
"use strict";

const http = process.getBuiltinModule("node:http");

const DEADLINE_SECONDS = Number(process.env.SHUTDOWN_DEADLINE_SECONDS || 25);
const servers = new Set();

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function patchedListen(...args) {
  servers.add(this);
  return listen.apply(this, args);
};

let stopping = false;

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.error(`[shutdown] ${signal}: no new connections; finishing the requests in progress (at most ${DEADLINE_SECONDS}s)`);

  let open = servers.size;
  if (open === 0) process.exit(0);

  const deadline = setTimeout(() => {
    console.error("[shutdown] deadline reached; closing the connections that are left");
    for (const server of servers) server.closeAllConnections();
    setTimeout(() => process.exit(1), 500).unref();
  }, DEADLINE_SECONDS * 1000);

  for (const server of servers) {
    server.close(() => {
      open -= 1;
      if (open === 0) {
        clearTimeout(deadline);
        console.error("[shutdown] done");
        process.exit(0);
      }
    });
    // A keep-alive connection with no request on it is not "in progress"; close it so close() can finish.
    server.closeIdleConnections();
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
