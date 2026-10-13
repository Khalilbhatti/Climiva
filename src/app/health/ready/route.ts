import { checkReadiness, deployedVersion } from "@/server/readiness";

export const dynamic = "force-dynamic";

/**
 * "This process can serve." 200 when its configuration, database and file storage are all fit, 503 when any is not. The body names which of the
 * three failed and nothing more: no error text, address, path or setting leaves, and no tenant data is read.
 */
export async function GET() {
  const readiness = await checkReadiness();
  return Response.json(
    { status: readiness.ready ? "ready" : "unavailable", version: deployedVersion(), checks: readiness.checks },
    { status: readiness.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
