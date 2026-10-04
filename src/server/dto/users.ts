import "server-only";
import type { SystemRole } from "@/lib/domain/roles";
import type { UserDoc } from "@/server/db/models";
import type { MemberBrandDTO, TeamMemberDTO } from "@/features/team/types";

export type { TeamMemberDTO };

export function toTeamMemberDTO(
  u: UserDoc,
  opts: {
    selfId: string;
    invitation?: { expiresAt: Date } | null;
    now?: Date;
    brands?: MemberBrandDTO[];
  },
): TeamMemberDTO {
  const now = opts.now ?? new Date();
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    invitedAt: u.invitedAt?.toISOString() ?? null,
    activatedAt: u.activatedAt?.toISOString() ?? null,
    invitation: opts.invitation
      ? {
          expiresAt: opts.invitation.expiresAt.toISOString(),
          expired: opts.invitation.expiresAt <= now,
        }
      : null,
    isSelf: String(u._id) === opts.selfId,
    brands: opts.brands ?? [],
  };
}

/** A user's view of their own account. */
export interface SelfDTO {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: SystemRole;
}

export function toSelfDTO(u: Pick<UserDoc, "_id" | "name" | "email" | "image" | "role">): SelfDTO {
  return { id: String(u._id), name: u.name, email: u.email, image: u.image ?? null, role: u.role };
}
