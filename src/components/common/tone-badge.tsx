import {
  SYSTEM_ROLE_LABEL,
  USER_STATUS_LABEL,
  type SystemRole,
  type UserStatus,
} from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

/**
 * The single place semantic colour is applied to state. Every status badge in
 * the product maps its value to one of these tones — never to ad-hoc colours.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClass: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral",
  info: "bg-tone-info-bg text-tone-info",
  success: "bg-tone-success-bg text-tone-success",
  warning: "bg-tone-warning-bg text-tone-warning",
  danger: "bg-tone-danger-bg text-tone-danger",
};

const dotClass: Record<Tone, string> = {
  neutral: "bg-tone-neutral/60",
  info: "bg-tone-info",
  success: "bg-tone-success",
  warning: "bg-tone-warning",
  danger: "bg-tone-danger",
};

export function ToneBadge({
  tone,
  children,
  dot = true,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}

const USER_STATUS_TONE: Record<UserStatus, Tone> = {
  ACTIVE: "success",
  INVITED: "info",
  SUSPENDED: "warning",
  DEACTIVATED: "neutral",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <ToneBadge tone={USER_STATUS_TONE[status]}>{USER_STATUS_LABEL[status]}</ToneBadge>;
}

/** Roles are identity, not state: rendered as a quiet outline label. */
export function RoleBadge({ role, className }: { role: SystemRole; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {SYSTEM_ROLE_LABEL[role]}
    </span>
  );
}
