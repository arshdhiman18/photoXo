"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { FieldError } from "@/components/common/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvitationAction } from "@/features/auth/actions";
import { acceptInvitationSchema } from "@/features/auth/schemas";
import { PASSWORD_MIN } from "@/lib/validation";

export function AcceptInviteForm({
  token,
  email,
  defaultName,
}: {
  token: string;
  email: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      token,
      name: String(fd.get("name") ?? ""),
      password: String(fd.get("password") ?? ""),
      confirmPassword: String(fd.get("confirmPassword") ?? ""),
    };
    const parsed = acceptInvitationSchema.safeParse(input);
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fe[String(i.path[0])] ??= []).push(i.message);
      setErrors(fe);
      return;
    }
    setErrors({});
    setFormError(null);
    start(async () => {
      const res = await acceptInvitationAction(input);
      if (!res.ok) {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        else setFormError(res.error.message);
        return;
      }
      router.replace(res.data.redirectTo);
      router.refresh();
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
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} readOnly disabled autoComplete="username" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultName}
          autoComplete="name"
          aria-invalid={!!errors.name}
        />
        <FieldError messages={errors.name} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="password-hint"
          aria-invalid={!!errors.password}
        />
        {errors.password ? (
          <FieldError messages={errors.password} />
        ) : (
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least {PASSWORD_MIN} characters. A short phrase works well.
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
        />
        <FieldError messages={errors.confirmPassword} />
      </div>
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
        {pending ? "Activating…" : "Activate account"}
      </Button>
    </form>
  );
}
