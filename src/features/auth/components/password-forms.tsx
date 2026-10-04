"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, MailCheck } from "lucide-react";
import { FieldError } from "@/components/common/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordSchema, resetPasswordSchema } from "@/features/auth/schemas";
import { authClient } from "@/lib/auth-client";
import { PASSWORD_MIN } from "@/lib/validation";

export function ForgotPasswordForm() {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <Alert>
        <MailCheck />
        <AlertDescription>
          If an active account exists for that email, a reset link is on its way. It expires in 1
          hour.
        </AlertDescription>
      </Alert>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({
      email: new FormData(e.currentTarget).get("email"),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Enter a valid email");
    setError(null);
    start(async () => {
      const res = await authClient.requestPasswordReset({
        email: parsed.data.email,
        redirectTo: "/reset-password",
      });
      if (res.error?.status === 429)
        return setError("Too many requests. Please wait a few minutes.");
      // Same response whether or not the account exists (no enumeration).
      setSent(true);
    });
  }

  return (
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
          aria-invalid={!!error}
        />
        <FieldError messages={error ? [error] : undefined} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
      password: String(fd.get("password") ?? ""),
      confirmPassword: String(fd.get("confirmPassword") ?? ""),
    });
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fe[String(i.path[0])] ??= []).push(i.message);
      return setErrors(fe);
    }
    setErrors({});
    start(async () => {
      const res = await authClient.resetPassword({ newPassword: parsed.data.password, token });
      if (res.error) {
        setFormError("This reset link is invalid or has expired. Request a new one.");
        return;
      }
      router.replace("/login?reset=1");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {formError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
        />
        {errors.password ? (
          <FieldError messages={errors.password} />
        ) : (
          <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN} characters.</p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
        />
        <FieldError messages={errors.confirmPassword} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
