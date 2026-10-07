import { BrandRole, SystemRole, UserStatus } from "./roles";

export const BrandStatus = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;
export type BrandStatus = (typeof BrandStatus)[keyof typeof BrandStatus];
export const BRAND_STATUSES = Object.values(BrandStatus);
export const BRAND_STATUS_LABEL: Record<BrandStatus, string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
};

export const MembershipStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];
export const MEMBERSHIP_STATUSES = Object.values(MembershipStatus);

/** Extensible social platform vocabulary (add values here, never hardcode). */
export const SocialPlatform = {
  INSTAGRAM: "INSTAGRAM",
  YOUTUBE: "YOUTUBE",
  FACEBOOK: "FACEBOOK",
  TIKTOK: "TIKTOK",
  LINKEDIN: "LINKEDIN",
  X: "X",
  PINTEREST: "PINTEREST",
  WEBSITE: "WEBSITE",
  OTHER: "OTHER",
} as const;
export type SocialPlatform = (typeof SocialPlatform)[keyof typeof SocialPlatform];
export const SOCIAL_PLATFORMS = Object.values(SocialPlatform);
export const SOCIAL_PLATFORM_LABEL: Record<SocialPlatform, string> = {
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  LINKEDIN: "LinkedIn",
  X: "X",
  PINTEREST: "Pinterest",
  WEBSITE: "Website",
  OTHER: "Other",
};
export const MAX_SOCIAL_HANDLES = 20;

// ── Brand roles ────────────────────────────────────────────────────────────

/** Display order for grouped team views. */
export const BRAND_ROLE_ORDER: BrandRole[] = [
  BrandRole.BRAND_MANAGER,
  BrandRole.VIDEOGRAPHER,
  BrandRole.PHOTOGRAPHER,
  BrandRole.CONTENT_CREATOR,
  BrandRole.EDITOR,
  BrandRole.DESIGNER,
  BrandRole.ASSISTANT,
  BrandRole.OTHER_PRODUCTION,
  BrandRole.UPLOADER,
  BrandRole.CLIENT,
];

export const BRAND_ROLE_LABEL: Record<BrandRole, string> = {
  BRAND_MANAGER: "Brand manager",
  VIDEOGRAPHER: "Videographer",
  PHOTOGRAPHER: "Photographer",
  CONTENT_CREATOR: "Content creator",
  EDITOR: "Editor",
  DESIGNER: "Graphic designer",
  ASSISTANT: "Assistant",
  OTHER_PRODUCTION: "Other production",
  UPLOADER: "Content uploader",
  CLIENT: "Client",
};

export const BRAND_ROLE_GROUP_LABEL: Record<BrandRole, string> = {
  BRAND_MANAGER: "Brand managers",
  VIDEOGRAPHER: "Videographers",
  PHOTOGRAPHER: "Photographers",
  CONTENT_CREATOR: "Content creators",
  EDITOR: "Editors",
  DESIGNER: "Graphic designers",
  ASSISTANT: "Assistants",
  OTHER_PRODUCTION: "Other production",
  UPLOADER: "Content uploaders",
  CLIENT: "Client users",
};

/** Internal (non-client) brand roles. */
export const INTERNAL_BRAND_ROLES: BrandRole[] = BRAND_ROLE_ORDER.filter(
  (r) => r !== BrandRole.CLIENT,
);

/**
 * Explicit SYSTEM ROLE ↔ BRAND ROLE compatibility. Anything not listed is
 * refused by the server.
 *
 *  · CLIENT brand role       ← CLIENT system role only (and vice versa:
 *                              client users can hold no other brand role)
 *  · BRAND_MANAGER           ← STAFF, MANAGER, ADMIN (agency leads often run brands)
 *  · production + UPLOADER   ← STAFF, MANAGER (managers may do hands-on work)
 */
export const BRAND_ROLE_ALLOWED_SYSTEM_ROLES: Record<BrandRole, readonly SystemRole[]> = {
  BRAND_MANAGER: [SystemRole.STAFF, SystemRole.MANAGER, SystemRole.ADMIN],
  VIDEOGRAPHER: [SystemRole.STAFF, SystemRole.MANAGER],
  PHOTOGRAPHER: [SystemRole.STAFF, SystemRole.MANAGER],
  CONTENT_CREATOR: [SystemRole.STAFF, SystemRole.MANAGER],
  EDITOR: [SystemRole.STAFF, SystemRole.MANAGER],
  DESIGNER: [SystemRole.STAFF, SystemRole.MANAGER],
  ASSISTANT: [SystemRole.STAFF, SystemRole.MANAGER],
  OTHER_PRODUCTION: [SystemRole.STAFF, SystemRole.MANAGER],
  UPLOADER: [SystemRole.STAFF, SystemRole.MANAGER],
  CLIENT: [SystemRole.CLIENT],
};

export function isRoleCompatible(systemRole: SystemRole, brandRole: BrandRole): boolean {
  return BRAND_ROLE_ALLOWED_SYSTEM_ROLES[brandRole].includes(systemRole);
}

/** Account states that can be assigned to a brand (invited people may be pre-assigned). */
export const ASSIGNABLE_USER_STATUSES: UserStatus[] = [UserStatus.ACTIVE, UserStatus.INVITED];
