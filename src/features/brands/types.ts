import type { BrandStatus, MembershipStatus, SocialPlatform } from "@/lib/domain/brands";
import type { BrandRole, SystemRole, UserStatus } from "@/lib/domain/roles";

export interface SocialHandleDTO {
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  label: string | null;
}

/** Brand row for the admin list. */
export interface BrandListItemDTO {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  status: BrandStatus;
  socialHandles: SocialHandleDTO[];
  teamCount: number;
  clientCount: number;
  primaryUploader: { id: string; name: string } | null;
  updatedAt: string;
}

export interface BrandListData {
  items: BrandListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: { ACTIVE: number; ARCHIVED: number };
}

/** Brand as administrators see it. */
export interface BrandDetailDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  status: BrandStatus;
  socialHandles: SocialHandleDTO[];
  primaryUploaderId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Brand as staff/clients see it: identity only, no internal fields. */
export interface BrandPublicDTO {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  socialHandles: SocialHandleDTO[];
}

/** A brand membership as administrators see it. */
export interface BrandMemberDTO {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  systemRole: SystemRole;
  userStatus: UserStatus;
  role: BrandRole;
  status: MembershipStatus;
  isPrimaryUploader: boolean;
  since: string;
  until: string | null;
}

export interface BrandTeamDTO {
  groups: { role: BrandRole; members: BrandMemberDTO[] }[];
  inactive: BrandMemberDTO[];
  primaryUploaderId: string | null;
  /** True when the primary uploader's account is not ACTIVE (routing would stall). */
  primaryUploaderUnavailable: boolean;
  activeMemberCount: number;
}

/**
 * Coworker as staff see them: collaboration fields only. Deliberately no
 * email, account status, system role or permissions.
 */
export interface CoworkerDTO {
  userId: string;
  name: string;
  image: string | null;
  roles: BrandRole[];
  isYou: boolean;
}

export interface MemberCandidateDTO {
  id: string;
  name: string;
  email: string;
  image: string | null;
  systemRole: SystemRole;
  userStatus: UserStatus;
}

/** A brand in "My brands" (staff) or the client's brand list. */
export interface MyBrandDTO extends BrandPublicDTO {
  myRoles: BrandRole[];
}
