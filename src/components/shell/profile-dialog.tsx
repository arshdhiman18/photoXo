"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { FieldError } from "@/components/common/field-error";
import type { ShellUser } from "@/components/shell/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/features/account/actions";
import { updateProfileSchema } from "@/features/account/schemas";
import { SYSTEM_ROLE_LABEL } from "@/lib/domain/roles";

export function ProfileDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ShellUser;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = { name: String(new FormData(e.currentTarget).get("name") ?? "") };
    const local = updateProfileSchema.safeParse(input);
    if (!local.success) {
      setErrors({ name: local.error.issues.map((i) => i.message) });
      return;
    }
    start(async () => {
      const res = await updateProfileAction(local.data);
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      setErrors({});
      toast.success("Profile updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Profile"
      description="How you appear to your team."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            name="name"
            defaultValue={user.name}
            autoComplete="name"
            aria-invalid={!!errors.name}
          />
          <FieldError messages={errors.name} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="profile-email">Email</Label>
          <Input id="profile-email" value={user.email} disabled readOnly />
          <p className="text-xs text-muted-foreground">
            Role: {SYSTEM_ROLE_LABEL[user.role]}. Email and role are managed by an administrator.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
