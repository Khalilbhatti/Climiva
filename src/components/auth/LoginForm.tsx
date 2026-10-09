"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { hardNavigate } from "@/lib/hard-navigate";
import { FormAlert } from "./AuthShell";

type Errors = { email?: string; password?: string };

/** What to tell the person for each way a Better Auth call can fail. Never says which of email or password was wrong. */
export function authErrorMessage(error: { status?: number; code?: string; message?: string }, fallback: string): string {
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) return "That email and password don't match. Check them and try again.";
  if (error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return "An account with that email already exists. Log in instead.";
  if (error.code === "PASSWORD_TOO_SHORT") return "Use a password of at least 8 characters.";
  if (error.code === "INVALID_EMAIL") return "Enter a valid email address.";
  return fallback;
}

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string>();
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Enter your email address.";
    if (!password) found.password = "Enter your password.";
    setErrors(found);
    setProblem(undefined);
    if (found.email || found.password) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setPending(true);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    if (error) {
      setProblem(authErrorMessage(error, "We couldn't log you in. Try again."));
      setPending(false);
      return;
    }
    // A full page load, so nothing from before (another account's state, a stale cache) survives the change of identity.
    hardNavigate(next ?? "/");
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-4">
      {problem && <FormAlert>{problem}</FormAlert>}
      <Input label="Email" type="email" required autoComplete="email" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
      <Input label="Password" type="password" required autoComplete="current-password" value={password} error={errors.password} onChange={(event) => setPassword(event.target.value)} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
