import "server-only";
import { SIGNED_OUT, failure } from "@/lib/action-result";
import { can, type Capability } from "@/lib/policy";
import { resolveWorkspace, type WorkspaceContext } from "./workspace";

type Failure = ReturnType<typeof failure>;

/**
 * The start of every server action that changes something. It resolves the caller from the session cookie and a verified
 * active membership (never from the arguments), then asks the one policy (lib/policy) whether that role may do this.
 *
 *   const auth = await authorize("services:manage", NOT_ALLOWED_SERVICES);
 *   if (!auth.ok) return auth.result;
 *   const { userId, organizationId } = auth.context;
 *
 * No action takes an organization from its arguments: the one it writes to is `auth.context.organizationId`.
 */
export async function authorize(capability: Capability, refusal: string): Promise<{ ok: true; context: WorkspaceContext } | { ok: false; result: Failure }> {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return { ok: false, result: failure(SIGNED_OUT) };
  if (!can(state.context.role, capability)) return { ok: false, result: failure(refusal) };
  return { ok: true, context: state.context };
}

/** For actions any signed-in member of the workspace may call (reads): the verified context, or the signed-out failure. */
export async function requireMember(): Promise<{ ok: true; context: WorkspaceContext } | { ok: false; result: Failure }> {
  const state = await resolveWorkspace();
  if (state.status !== "ready") return { ok: false, result: failure(SIGNED_OUT) };
  return { ok: true, context: state.context };
}
