import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/safe-path";
import { getSessionUser } from "@/server/session";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === "string" ? next : undefined);
  // Already signed in (a real session, not just a cookie): nothing to do here.
  if (await getSessionUser()) redirect((target ?? "/") as "/");

  return (
    <AuthShell
      title="Log in"
      description="Welcome back. Log in to your Climvia workspace."
      footer={
        <>
          New to Climvia?{" "}
          <Link href="/signup" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={target} />
    </AuthShell>
  );
}
