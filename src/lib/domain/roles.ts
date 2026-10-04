/**
 * Identity & access vocabulary shared by server and client code.
 * Never compare against string literals elsewhere — import these constants.
 */

/** System role: which part of the product a user may enter. */
export const SystemRole = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
  CLIENT: "CLIENT",
} as const;
export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];
export const SYSTEM_ROLES = Object.values(SystemRole);

export const SYSTEM_ROLE_LABEL: Record<SystemRole, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
  CLIENT: "Client",
};

export const SYSTEM_ROLE_DESCRIPTION: Record<SystemRole, string> = {
  ADMIN: "Full access including users, roles and system settings.",
  MANAGER: "Runs production, approvals and expenses. No user or system administration.",
  STAFF: "Production employee. Sees only assigned work.",
  CLIENT: "Brand client. Sees only their brand's content awaiting approval.",
};

/**
 * Roles an admin may assign through the normal UI. ADMIN is deliberately
 * excluded: admins are created only through the controlled `create-admin`
 * bootstrap (see docs/setup.md).
 */
export const INVITABLE_ROLES = [SystemRole.MANAGER, SystemRole.STAFF, SystemRole.CLIENT] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const UserStatus = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  DEACTIVATED: "DEACTIVATED",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = Object.values(UserStatus);

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Deactivated",
};

/**
 * Brand-level role (what someone does for a specific brand). A separate
 * concept from SystemRole — e.g. Rahul is STAFF globally and VIDEOGRAPHER on
 * Mamaearth. Memberships themselves arrive in Stage 2; the vocabulary is
 * defined now so the two levels are never conflated.
 */
export const BrandRole = {
  BRAND_MANAGER: "BRAND_MANAGER",
  VIDEOGRAPHER: "VIDEOGRAPHER",
  PHOTOGRAPHER: "PHOTOGRAPHER",
  EDITOR: "EDITOR",
  DESIGNER: "DESIGNER",
  ASSISTANT: "ASSISTANT",
  OTHER_PRODUCTION: "OTHER_PRODUCTION",
  UPLOADER: "UPLOADER",
  CLIENT: "CLIENT",
} as const;
export type BrandRole = (typeof BrandRole)[keyof typeof BrandRole];

/** Workspaces (top-level route areas). */
export const Workspace = {
  ADMIN: "admin",
  WORK: "work",
  CLIENT: "client",
} as const;
export type Workspace = (typeof Workspace)[keyof typeof Workspace];
