"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Star,
  UserCog,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { ToneBadge } from "@/components/common/tone-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  changeMemberRoleAction,
  deactivateMemberAction,
  reactivateMemberAction,
  setPrimaryUploaderAction,
} from "@/features/brands/actions";
import { AddMemberDialog } from "@/features/brands/components/add-member-dialog";
import type { BrandMemberDTO, BrandTeamDTO } from "@/features/brands/types";
import type { ActionResult } from "@/lib/action-result";
import {
  BRAND_ROLE_GROUP_LABEL,
  BRAND_ROLE_LABEL,
  BRAND_ROLE_ORDER,
  isRoleCompatible,
} from "@/lib/domain/brands";
import { BrandRole, SYSTEM_ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error.message);
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

export function BrandTeamPanel({
  brandId,
  brandName,
  archived,
  team,
}: {
  brandId: string;
  brandName: string;
  archived: boolean;
  team: BrandTeamDTO;
}) {
  const [addRole, setAddRole] = useState<BrandRole | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const { run, pending } = useRun();

  const openAdd = (role: BrandRole | null) => {
    setAddRole(role);
    setAddOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {team.activeMemberCount === 0
            ? "No one is assigned to this brand yet."
            : `${team.activeMemberCount} ${team.activeMemberCount === 1 ? "person" : "people"} assigned. A person can hold several roles.`}
        </p>
        <Button
          onClick={() => openAdd(null)}
          disabled={archived}
          className="self-start sm:self-auto"
        >
          <Plus data-icon="inline-start" />
          Add member
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {team.groups.map((group) => (
          <section
            key={group.role}
            className="flex min-w-0 flex-col rounded-xl border bg-card shadow-xs"
          >
            <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {BRAND_ROLE_GROUP_LABEL[group.role]}
                <span className="tabular-nums">{group.members.length}</span>
              </h2>
              {!archived && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => openAdd(group.role)}
                  aria-label={`Add ${BRAND_ROLE_LABEL[group.role]}`}
                >
                  <Plus /> Add
                </Button>
              )}
            </header>
            {group.members.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {group.role === BrandRole.UPLOADER
                  ? "No Content Uploader — ready-to-post content would have no owner."
                  : "No one assigned."}
              </p>
            ) : (
              <ul className="divide-y">
                {group.members.map((m) => (
                  <MemberRow key={m.membershipId} m={m} brandId={brandId} archived={archived} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {team.inactive.length > 0 && (
        <section className="rounded-xl border bg-card shadow-xs">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            aria-expanded={showInactive}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm"
          >
            <span className="font-medium">
              Past assignments{" "}
              <span className="font-normal text-muted-foreground">· {team.inactive.length}</span>
            </span>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                showInactive && "rotate-180",
              )}
            />
          </button>
          {showInactive && (
            <ul className="divide-y border-t">
              {team.inactive.map((m) => (
                <li key={m.membershipId} className="flex items-center gap-3 px-4 py-2.5">
                  <UserAvatar
                    name={m.name}
                    image={m.image}
                    seed={m.userId}
                    className="size-7 opacity-70"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {BRAND_ROLE_LABEL[m.role]}
                    </p>
                  </div>
                  {!archived && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => reactivateMemberAction({ brandId, membershipId: m.membershipId }),
                          `${m.name.split(" ")[0]} restored as ${BRAND_ROLE_LABEL[m.role]}`,
                        )
                      }
                    >
                      <RotateCcw data-icon="inline-start" />
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {addOpen && (
        <AddMemberDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          brandId={brandId}
          brandName={brandName}
          initialRole={addRole}
        />
      )}
    </div>
  );
}

function MemberRow({
  m,
  brandId,
  archived,
}: {
  m: BrandMemberDTO;
  brandId: string;
  archived: boolean;
}) {
  const { run, pending } = useRun();
  const [confirm, setConfirm] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const first = m.name.split(" ")[0];
  const target = { brandId, membershipId: m.membershipId };

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <UserAvatar name={m.name} image={m.image} seed={m.userId} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{m.name}</span>
          {m.isPrimaryUploader && (
            <ToneBadge tone="info" dot={false}>
              <Star className="size-3" /> Primary
            </ToneBadge>
          )}
          {m.userStatus !== "ACTIVE" && (
            <ToneBadge tone={m.userStatus === "INVITED" ? "info" : "warning"}>
              {USER_STATUS_LABEL[m.userStatus]}
            </ToneBadge>
          )}
          {m.systemRole !== "STAFF" && m.systemRole !== "CLIENT" && (
            <span className="text-xs font-normal text-muted-foreground">
              {SYSTEM_ROLE_LABEL[m.systemRole]}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
      </div>
      {!archived && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${m.name}`}
              disabled={pending}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {m.role === BrandRole.UPLOADER && !m.isPrimaryUploader && (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => setPrimaryUploaderAction({ brandId, userId: m.userId }),
                    `${first} is now the primary uploader`,
                  )
                }
              >
                <Star />
                Make primary uploader
              </DropdownMenuItem>
            )}
            {m.role !== BrandRole.CLIENT && (
              <DropdownMenuItem onSelect={() => setRoleOpen(true)}>
                <UserCog />
                Change role…
              </DropdownMenuItem>
            )}
            {m.role !== BrandRole.CLIENT && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
              <UserMinus />
              Remove from brand
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ResponsiveDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove ${first} as ${BRAND_ROLE_LABEL[m.role]}?`}
        description={
          m.isPrimaryUploader
            ? "They are the primary uploader — the brand will have no default uploader until you choose another. The assignment is kept in history and can be restored."
            : "They lose access to this brand's work for this role immediately. The assignment is kept in history and can be restored."
        }
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(
                () => deactivateMemberAction(target),
                `${first} removed`,
                () => setConfirm(false),
              )
            }
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        </div>
      </ResponsiveDialog>

      {roleOpen && (
        <ChangeBrandRoleDialog
          open={roleOpen}
          onOpenChange={setRoleOpen}
          member={m}
          pending={pending}
          onSubmit={(role) =>
            run(
              () => changeMemberRoleAction({ ...target, role }),
              `${first} is now ${BRAND_ROLE_LABEL[role]}`,
              () => setRoleOpen(false),
            )
          }
        />
      )}
    </li>
  );
}

function ChangeBrandRoleDialog({
  open,
  onOpenChange,
  member,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member: BrandMemberDTO;
  pending: boolean;
  onSubmit: (role: BrandRole) => void;
}) {
  const options = BRAND_ROLE_ORDER.filter((r) => isRoleCompatible(member.systemRole, r));
  const [role, setRole] = useState<BrandRole>(member.role);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change ${member.name.split(" ")[0]}'s brand role`}
      description="The current role assignment is closed and a new one starts. History is kept."
    >
      <div className="flex flex-col gap-4">
        <Select value={role} onValueChange={(v) => setRole(v as BrandRole)}>
          <SelectTrigger className="w-full" aria-label="Brand role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((r) => (
              <SelectItem key={r} value={r}>
                {BRAND_ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || role === member.role} onClick={() => onSubmit(role)}>
            {pending ? "Saving…" : "Save role"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
