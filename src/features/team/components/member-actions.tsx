"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Link2,
  Trash2,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  UserCog,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  changeUserRoleAction,
  deactivateUserAction,
  deleteUserAction,
  reactivateUserAction,
  resendInvitationAction,
  revokeInvitationAction,
  suspendUserAction,
} from "@/features/team/actions";
import { InviteLinkDialog, type IssuedInvite } from "@/features/team/components/invite-link-dialog";
import { RoleRadioGroup } from "@/features/team/components/role-radio-group";
import type { TeamMemberDTO } from "@/features/team/types";
import type { ActionResult } from "@/lib/action-result";
import { SYSTEM_ROLE_LABEL, SystemRole, UserStatus, type InvitableRole } from "@/lib/domain/roles";

type Confirm = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => Promise<ActionResult<unknown>>;
  success: string;
};

/**
 * Row-level account actions. Only offered for non-admin members other than
 * yourself — the server enforces the same rule regardless.
 */
export function MemberActions({ member }: { member: TeamMemberDTO }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedInvite | null>(null);

  if (member.isSelf || member.role === SystemRole.ADMIN) {
    return <span className="inline-block size-8" aria-hidden />;
  }

  const id = { userId: member.id };
  const first = member.name.split(" ")[0];

  function run(fn: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }

  const s = member.status;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${member.name}`}
            disabled={pending}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {s === UserStatus.INVITED && (
            <>
              <DropdownMenuItem
                onSelect={() =>
                  start(async () => {
                    const res = await resendInvitationAction(id);
                    if (!res.ok) return void toast.error(res.error.message);
                    setIssued({ ...res.data.invite, name: member.name, email: member.email });
                    router.refresh();
                  })
                }
              >
                <Link2 />
                Get new invite link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  setConfirm({
                    title: `Revoke ${first}'s invitation?`,
                    description:
                      "The invitation link stops working immediately. You can reactivate and resend later.",
                    confirmLabel: "Revoke invitation",
                    destructive: true,
                    run: () => revokeInvitationAction(id),
                    success: "Invitation revoked",
                  })
                }
              >
                <XCircle />
                Revoke invitation
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  setConfirm({
                    title: `Delete ${first}?`,
                    description:
                      "They haven't joined yet, so they're removed completely: account, invitation and brand assignments. This can't be undone.",
                    confirmLabel: "Delete permanently",
                    destructive: true,
                    run: () => deleteUserAction(id),
                    success: `${first} deleted`,
                  })
                }
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}

          {(s === UserStatus.ACTIVE || s === UserStatus.SUSPENDED) && (
            <DropdownMenuItem onSelect={() => setRoleOpen(true)}>
              <UserCog />
              Change role…
            </DropdownMenuItem>
          )}

          {(s === UserStatus.SUSPENDED || s === UserStatus.DEACTIVATED) && (
            <DropdownMenuItem
              onSelect={() => run(() => reactivateUserAction(id), `${first} reactivated`)}
            >
              <PlayCircle />
              Reactivate
            </DropdownMenuItem>
          )}

          {s === UserStatus.ACTIVE && (
            <DropdownMenuItem
              onSelect={() =>
                setConfirm({
                  title: `Suspend ${first}?`,
                  description:
                    "They're signed out everywhere immediately and can't sign in until reactivated.",
                  confirmLabel: "Suspend",
                  run: () => suspendUserAction(id),
                  success: `${first} suspended`,
                })
              }
            >
              <PauseCircle />
              Suspend
            </DropdownMenuItem>
          )}

          {(s === UserStatus.ACTIVE || s === UserStatus.SUSPENDED) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  setConfirm({
                    title: `Deactivate ${first}?`,
                    description:
                      "Use this when someone leaves. They lose access immediately. Their history is kept and the account can be reactivated.",
                    confirmLabel: "Deactivate",
                    destructive: true,
                    run: () => deactivateUserAction(id),
                    success: `${first} deactivated`,
                  })
                }
              >
                <Ban />
                Deactivate
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ResponsiveDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm?.destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => confirm && run(confirm.run, confirm.success, () => setConfirm(null))}
          >
            {pending ? "Working…" : confirm?.confirmLabel}
          </Button>
        </div>
      </ResponsiveDialog>

      <ChangeRoleDialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        member={member}
        pending={pending}
        onSubmit={(role) =>
          run(
            () => changeUserRoleAction({ userId: member.id, role }),
            `${first} is now ${SYSTEM_ROLE_LABEL[role]}`,
            () => setRoleOpen(false),
          )
        }
      />
      <InviteLinkDialog invite={issued} onOpenChange={(o) => !o && setIssued(null)} />
    </>
  );
}

function ChangeRoleDialog({
  open,
  onOpenChange,
  member,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member: TeamMemberDTO;
  pending: boolean;
  onSubmit: (role: InvitableRole) => void;
}) {
  const [role, setRole] = useState<InvitableRole | undefined>(member.role as InvitableRole);
  const crossesBoundary =
    role !== undefined &&
    role !== member.role &&
    (role === SystemRole.CLIENT || member.role === SystemRole.CLIENT);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change ${member.name.split(" ")[0]}'s role`}
      description="Takes effect on their next request."
    >
      <div className="flex flex-col gap-4">
        <RoleRadioGroup name={`role-${member.id}`} value={role} onChange={setRole} />
        {crossesBoundary && (
          <p className="rounded-lg bg-tone-warning-bg px-3 py-2 text-xs text-tone-warning">
            This moves the person between the client and internal sides of PhotoXo. Double-check
            before saving.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !role || role === member.role}
            onClick={() => role && onSubmit(role)}
          >
            {pending ? "Saving…" : "Save role"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
