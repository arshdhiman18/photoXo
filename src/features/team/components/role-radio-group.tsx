"use client";

import {
  INVITABLE_ROLES,
  SYSTEM_ROLE_DESCRIPTION,
  SYSTEM_ROLE_LABEL,
  type InvitableRole,
} from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

/** Accessible radio cards for choosing a system role (ADMIN is never offered). */
export function RoleRadioGroup({
  name,
  value,
  onChange,
  invalid,
}: {
  name: string;
  value: InvitableRole | undefined;
  onChange: (role: InvitableRole) => void;
  invalid?: boolean;
}) {
  return (
    <div role="radiogroup" aria-invalid={invalid} className="grid gap-2">
      {INVITABLE_ROLES.map((role) => {
        const checked = value === role;
        return (
          <label
            key={role}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              checked ? "border-foreground/60 bg-subtle" : "hover:bg-subtle",
              invalid && !value && "border-destructive/60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={role}
              checked={checked}
              onChange={() => onChange(role)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{SYSTEM_ROLE_LABEL[role]}</span>
              <span className="block text-xs text-pretty text-muted-foreground">
                {SYSTEM_ROLE_DESCRIPTION[role]}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
