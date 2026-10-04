"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteUserAction } from "@/features/team/actions";
import { RoleRadioGroup } from "@/features/team/components/role-radio-group";
import { inviteUserSchema } from "@/features/team/schemas";
import type { InviteDelivery } from "@/features/team/types";
import type { InvitableRole } from "@/lib/domain/roles";

type Errors = Partial<Record<"name" | "email" | "role", string[]>>;

export function notifyDelivery(delivery: InviteDelivery, email: string) {
  if (delivery === "sent") toast.success(`Invitation sent to ${email}`);
  else if (delivery === "logged")
    toast.info("Invitation created", {
      description:
        "Email isn't configured in development — the invitation link was printed to the server console.",
    });
  else
    toast.warning("Invitation created, but the email couldn't be sent", {
      description: "Use “Resend invitation” from the member's menu to try again.",
    });
}

export function InviteButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        Invite member
      </Button>
      <InviteDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [role, setRole] = useState<InvitableRole | undefined>();
  const [errors, setErrors] = useState<Errors>({});
  const [formKey, setFormKey] = useState(0);

  function reset() {
    setRole(undefined);
    setErrors({});
    setFormKey((k) => k + 1);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = inviteUserSchema.safeParse({
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      role,
    });
    if (!parsed.success) {
      const fe: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        (fe[key] ??= []).push(issue.message);
      }
      setErrors(fe);
      return;
    }
    start(async () => {
      const res = await inviteUserAction(parsed.data);
      if (!res.ok) {
        if (res.error.code === "CONFLICT") setErrors({ email: [res.error.message] });
        else if (res.error.fieldErrors) setErrors(res.error.fieldErrors as Errors);
        else toast.error(res.error.message);
        return;
      }
      notifyDelivery(res.data.delivery, parsed.data.email);
      onOpenChange(false);
      reset();
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      title="Invite a team member"
      description="They'll get an email with a link to set their password. Links expire after 7 days."
    >
      <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-name">Full name</Label>
          <Input
            id="invite-name"
            name="name"
            autoComplete="off"
            placeholder="e.g. Rahul Sharma"
            aria-invalid={!!errors.name}
          />
          <FieldError messages={errors.name} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">Work email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="e.g. rahul@agency.com"
            aria-invalid={!!errors.email}
          />
          <FieldError messages={errors.email} />
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Role</legend>
          <RoleRadioGroup name="role" value={role} onChange={setRole} invalid={!!errors.role} />
          <FieldError messages={errors.role} />
          <p className="text-xs text-muted-foreground">
            Brand-level roles (videographer, editor, uploader…) are assigned per brand.
          </p>
        </fieldset>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send invitation"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
