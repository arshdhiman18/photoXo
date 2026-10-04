"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { FieldError } from "@/components/common/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema } from "@/features/auth/schemas";
import { authClient } from "@/lib/auth-client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.2 3.31v2.75h3.56c2.08-1.92 3.24-4.74 3.24-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.75c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.12A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.45.34-2.12V7.04H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.96l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function LoginForm({
  next,
  googleEnabled,
  reset,
}: {
  next?: string;
  googleEnabled: boolean;
  reset?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fe[String(i.path[0])] ??= []).push(i.message);
      setFieldErrors(fe);
      return;
    }
    setFieldErrors({});
    setError(null);
    start(async () => {
      const res = await authClient.signIn.email({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (res.error) {
        const status = res.error.status;
        setError(
          status === 403
            ? (res.error.message ?? "This account is not active.")
            : status === 429
              ? "Too many attempts. Please wait a minute and try again."
              : "Incorrect email or password.",
        );
        return;
      }
      router.replace(next ?? "/");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {reset && !error && (
        <Alert>
          <CheckCircle2 />
          <AlertDescription>
            Your password was updated. Sign in with your new password.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            aria-invalid={!!fieldErrors.email}
          />
          <FieldError messages={fieldErrors.email} />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
          />
          <FieldError messages={fieldErrors.password} />
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await authClient.signIn.social({
                  provider: "google",
                  callbackURL: next ?? "/",
                  errorCallbackURL: "/login?error=google",
                });
                if (res?.error) setError("Google sign-in is only available for invited accounts.");
              })
            }
          >
            <GoogleIcon />
            Continue with Google
          </Button>
        </>
      )}
    </div>
  );
}
