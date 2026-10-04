"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/common/tone-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { ProfileDialog } from "@/components/shell/profile-dialog";
import type { ShellUser } from "@/components/shell/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export interface WorkspaceLink {
  href: string;
  label: string;
}

export function useSignOut() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const signOut = () =>
    start(async () => {
      const res = await authClient.signOut();
      if (res.error) {
        toast.error("Couldn't sign out. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    });
  return { signOut, pending };
}

/**
 * Account menu. `variant="row"` renders a full-width trigger (sidebar footer);
 * `variant="avatar"` renders just the avatar (top bars).
 */
export function UserMenu({
  user,
  variant = "avatar",
  switchTo,
  align = "end",
  side = "bottom",
}: {
  user: ShellUser;
  variant?: "avatar" | "row";
  switchTo?: WorkspaceLink[];
  align?: "start" | "end";
  side?: "top" | "bottom" | "right";
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { signOut, pending } = useSignOut();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            variant === "avatar" && "rounded-full",
            variant === "row" &&
              "flex w-full min-w-0 items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
          )}
          aria-label="Account menu"
        >
          <UserAvatar
            name={user.name}
            image={user.image}
            seed={user.id}
            className={variant === "avatar" ? "size-8" : undefined}
          />
          {variant === "row" && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} side={side} className="w-64">
          <DropdownMenuLabel className="flex items-center gap-2.5 py-2 font-normal">
            <UserAvatar name={user.name} image={user.image} seed={user.id} className="size-8" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {user.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
            <RoleBadge role={user.role} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
              <UserRound />
              Profile
            </DropdownMenuItem>
            {switchTo?.map((w) => (
              <DropdownMenuItem key={w.href} asChild>
                <Link href={w.href}>
                  <ArrowLeftRight />
                  {w.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut} disabled={pending}>
            <LogOut />
            {pending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} user={user} />
    </>
  );
}
