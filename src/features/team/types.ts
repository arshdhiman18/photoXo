import type { BrandRole, SystemRole, UserStatus } from "@/lib/domain/roles";

/** A brand a person is actively assigned to, with their roles on it. */
export interface MemberBrandDTO {
  id: string;
  name: string;
  archived: boolean;
  roles: BrandRole[];
}

/** What the admin Team page may see about a user. Explicit allow-list (built in server/dto/users.ts). */
export interface TeamMemberDTO {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: SystemRole;
  status: UserStatus;
  createdAt: string;
  invitedAt: string | null;
  activatedAt: string | null;
  invitation: { expiresAt: string; expired: boolean } | null;
  isSelf: boolean;
  brands: MemberBrandDTO[];
}

export interface TeamListData {
  items: TeamMemberDTO[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Partial<Record<UserStatus, number>>;
}

/** sent = provider accepted · logged = dev console only · failed = provider error (admin can resend) */
export type InviteDelivery = "sent" | "logged" | "failed";

/**
 * Returned only to the admin who issued the invitation, so they can share the
 * link themselves (copy / WhatsApp). The token is never stored in plain text —
 * this response is the only place it exists; a new link revokes the old one.
 */
export interface InviteLinkDTO {
  delivery: InviteDelivery;
  url: string;
  expiresInDays: number;
  agencyName: string;
}
