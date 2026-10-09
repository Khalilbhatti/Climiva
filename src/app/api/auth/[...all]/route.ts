import { getAuth } from "@/lib/auth";

// Every sign-up, sign-in, sign-out and session lookup the browser makes lands here. Better Auth does the work,
// including its origin (CSRF) checks and rate limiting; the instance is created on first request, not at build time.
export const dynamic = "force-dynamic";

const handle = (request: Request) => getAuth().handler(request);

export const GET = handle;
export const POST = handle;
