import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { isPlatformAdmin } from "@/db/platform-queries";
import { getSessionUser } from "@/server/session";

export const metadata: Metadata = { title: "Platform sign-in" };
export const dynamic = "force-dynamic";

/**
 * The console's door. It signs in with the ordinary Better Auth accounts and says nothing about who may enter: signing in proves who someone is,
 * and the console then asks the database whether that person is a platform administrator. An administrator who is already signed in is sent on;
 * everyone else sees the same form, so this page does not reveal who is one.
 */
export default async function PlatformLoginPage() {
  const user = await getSessionUser();
  if (user && (await isPlatformAdmin(user.id))) redirect("/platform-admin");

  return (
    <AuthShell title="Platform sign-in" description="Sign in with your Climvia account. The platform console is limited to Climvia's administrators.">
      <LoginForm next="/platform-admin" />
    </AuthShell>
  );
}
