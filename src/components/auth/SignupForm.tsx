"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authClient } from "@/lib/auth-client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth-rules";
import { hardNavigate } from "@/lib/hard-navigate";
import { FormAlert } from "./AuthShell";
import { authErrorMessage } from "./LoginForm";

type Errors = { name?: string; email?: string; password?: string };

export function SignupForm() {
  const [name, setName] = useState("");
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
    if (!name.trim()) found.name = "Enter your full name.";
    else if (name.trim().length > 60) found.name = "Keep your name to 60 characters or fewer.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Enter a valid email address.";
    if (password.length < MIN_PASSWORD_LENGTH) found.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (password.length > MAX_PASSWORD_LENGTH) found.password = `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
    setErrors(found);
    setProblem(undefined);
    if (found.name || found.email || found.password) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setPending(true);
    const { error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    if (error) {
      setProblem(authErrorMessage(error, "We couldn't create your account. Try again."));
      setPending(false);
      return;
    }
    // Signed in by the sign-up itself; the next step is setting up their business.
    hardNavigate("/onboarding");
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-4">
      {problem && <FormAlert>{problem}</FormAlert>}
      <Input label="Full name" required autoComplete="name" maxLength={60} value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
      <Input label="Email" type="email" required autoComplete="email" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
      <Input
        label="Password"
        type="password"
        required
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        value={password}
        error={errors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
