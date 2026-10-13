import { deployedVersion } from "@/server/readiness";

export const dynamic = "force-dynamic";

/**
 * "The process is running." No database, no storage, no session, nothing that can be slow or fail for a reason outside this process: a
 * container's liveness check must say "restart me" only when the process itself is stuck. Whether it can SERVE is /health/ready.
 */
export function GET() {
  return Response.json({ status: "ok", version: deployedVersion() }, { headers: { "Cache-Control": "no-store" } });
}
