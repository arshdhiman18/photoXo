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
import { InviteLinkDialog, type IssuedInvite } from "@/features/team/components/invite-link-dialog";
import { RoleRadioGroup } from "@/features/team/components/role-radio-group";
import { inviteUserSchema } from "@/features/team/schemas";
import type { InvitableRole } from "@/lib/domain/roles";

type Errors = Partial<Record<"name" | "email" | "role", string[]>>;

export function InviteButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        Invite member
      </Button>
      <InviteDialog open={open} onOpenChange={setOpen} onIssued={setIssued} />
      <InviteLinkDialog invite={issued} onOpenChange={(o) => !o && setIssued(null)} />
    </>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: (invite: IssuedInvite) => void;
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
      toast.success(`${parsed.data.name} invited`);
      onOpenChange(false);
      reset();
      onIssued({ ...res.data.invite, name: parsed.data.name, email: parsed.data.email });
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
      description="You'll get a link to share with them (copy or WhatsApp) so they can set their password. Links expire after 7 days."
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
            {pending ? "Creating…" : "Create invite link"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
