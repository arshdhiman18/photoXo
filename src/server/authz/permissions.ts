import { SystemRole, Workspace, type InvitableRole } from "@/lib/domain/roles";
import type { Actor } from "./actor";
import { ForbiddenError } from "./errors";

/**
 * Centralised capability checks. Pure functions of the actor (and target,
 * where relevant) so they are trivially unit-testable.
 *
 * The UI may call these (via a serialisable `PermissionSet`) to hide
 * controls, but every service re-checks them — hiding a button is never the
 * enforcement.
 */

type Who = Pick<Actor, "systemRole">;

const is = (actor: Who, ...roles: SystemRole[]) => roles.includes(actor.systemRole);
const INTERNAL_OPS = [SystemRole.ADMIN, SystemRole.MANAGER] as const;

// ── Administration (ADMIN only) ────────────────────────────────────────────
export const canManageUsers = (a: Who) => is(a, SystemRole.ADMIN);
export const canManageRoles = (a: Who) => is(a, SystemRole.ADMIN);
export const canManageSettings = (a: Who) => is(a, SystemRole.ADMIN);

// ── Operations (ADMIN + MANAGER) ───────────────────────────────────────────
export const canManageProduction = (a: Who) => is(a, ...INTERNAL_OPS);
export const canManageBrands = (a: Who) => is(a, ...INTERNAL_OPS);
/** Assign people to brands (incl. client users and uploaders). Operational, not user administration. */
export const canManageBrandTeam = (a: Who) => is(a, ...INTERNAL_OPS);
export const canCreateContent = (a: Who) => is(a, ...INTERNAL_OPS);
/** Edit any field, change route/uploader, cancel/archive content. */
export const canManageContent = (a: Who) => is(a, ...INTERNAL_OPS);
/** Accept / reject / request changes on TEAM_IDEA content (planning decision, not approval). */
export const canReviewIdeas = (a: Who) => is(a, ...INTERNAL_OPS);
/** Create, edit, reschedule, cancel shoots; manage crew; override conflicts. */
export const canManageShoots = (a: Who) => is(a, ...INTERNAL_OPS);
/** Create, assign, reassign and cancel production tasks. */
export const canManageTasks = (a: Who) => is(a, ...INTERNAL_OPS);
/** Decide the INTERNAL approval gate (approve / request changes). */
export const canApproveContent = (a: Who) => is(a, ...INTERNAL_OPS);
/** See review queues, client-review status and full approval history. */
export const canManageClientApprovals = (a: Who) => is(a, ...INTERNAL_OPS);
/**
 * Record a CLIENT decision given outside the portal (e.g. WhatsApp) — ADMIN
 * only (Stage 0 D-8). Stored as RECORDED_BY_ADMIN with a mandatory note; it is
 * never presented as the client's own click.
 */
export const canRecordClientApprovalOnBehalf = (a: Who) => is(a, SystemRole.ADMIN);
/** See Ready-to-Post queues, posting records and their history agency-wide. */
export const canViewPostings = (a: Who) => is(a, ...INTERNAL_OPS);
/** Set the platforms content must be posted to (single source of truth). */
export const canSetTargetPlatforms = (a: Who) => is(a, ...INTERNAL_OPS);
/** Start a post-publication revision of posted/completed content (new version + new rounds). */
export const canStartRevision = (a: Who) => is(a, ...INTERNAL_OPS);
/** Send approved (not yet posted) content back for changes. */
export const canReopenApprovedContent = (a: Who) => is(a, ...INTERNAL_OPS);
/**
 * Record a posting on the assigned uploader's behalf (mandatory reason) —
 * ADMIN only, mirroring "record client approval on behalf". Never presented
 * as the uploader's own confirmation.
 */
export const canRecordPostingOnBehalf = (a: Who) => is(a, SystemRole.ADMIN);
/** Controlled correction of a confirmed posting (previous values kept, audited). */
export const canCorrectPostings = (a: Who) => is(a, SystemRole.ADMIN);
/** Decide the CLIENT approval gate personally — client users only. */
export const canGiveClientApproval = (a: Who) => is(a, SystemRole.CLIENT);
export const canViewAllExpenses = (a: Who) => is(a, ...INTERNAL_OPS);
export const canApproveExpenses = (a: Who) => is(a, ...INTERNAL_OPS);
export const canViewProductionBoard = (a: Who) => is(a, ...INTERNAL_OPS);
/** Read-only staff directory (needed to assign crew). Not user administration. */
export const canViewTeamDirectory = (a: Who) => is(a, ...INTERNAL_OPS);

// ── Self-service (any active user) ─────────────────────────────────────────
export const canSubmitExpenses = (a: Who) =>
  is(a, SystemRole.ADMIN, SystemRole.MANAGER, SystemRole.STAFF);
/** See the (limited) team of brands one can see. Clients never see brand teams. */
export const canViewCoworkers = (a: Who) =>
  is(a, SystemRole.ADMIN, SystemRole.MANAGER, SystemRole.STAFF);
export const canProposeIdeas = (a: Who) =>
  is(a, SystemRole.ADMIN, SystemRole.MANAGER, SystemRole.STAFF);

// ── Workspaces ─────────────────────────────────────────────────────────────
const WORKSPACE_ROLES: Record<Workspace, readonly SystemRole[]> = {
  [Workspace.ADMIN]: INTERNAL_OPS,
  // Admins/managers may open the staff workspace for their own assignments.
  [Workspace.WORK]: [SystemRole.ADMIN, SystemRole.MANAGER, SystemRole.STAFF],
  [Workspace.CLIENT]: [SystemRole.CLIENT],
};

export const canAccessWorkspace = (a: Who, ws: Workspace) =>
  WORKSPACE_ROLES[ws].includes(a.systemRole);

export function homeWorkspaceFor(a: Who): Workspace {
  switch (a.systemRole) {
    case SystemRole.ADMIN:
    case SystemRole.MANAGER:
      return Workspace.ADMIN;
    case SystemRole.STAFF:
      return Workspace.WORK;
    case SystemRole.CLIENT:
      return Workspace.CLIENT;
  }
}

export const homePathFor = (a: Who) => `/${homeWorkspaceFor(a)}`;

// ── Target-aware rules for user administration ─────────────────────────────
type Target = { id: string; role: SystemRole };

/**
 * May `actor` change account state (suspend/reactivate/deactivate/role) of
 * `target`? Admins can manage any non-admin account but never themselves or
 * another admin through the normal UI.
 */
export function canAdministerUser(actor: Actor, target: Target): boolean {
  if (!canManageUsers(actor)) return false;
  if (target.id === actor.userId) return false;
  if (target.role === SystemRole.ADMIN) return false;
  return true;
}

export function canAssignRole(actor: Actor, role: SystemRole): role is InvitableRole {
  return canManageRoles(actor) && role !== SystemRole.ADMIN;
}

// ── Assertion helper ───────────────────────────────────────────────────────
export function assertCan(allowed: boolean, message?: string): asserts allowed {
  if (!allowed) throw new ForbiddenError(message);
}

// ── Serialisable snapshot for UI (hide/show only — never enforcement) ─────
export interface PermissionSet {
  manageUsers: boolean;
  manageSettings: boolean;
  manageProduction: boolean;
  approveContent: boolean;
  viewAllExpenses: boolean;
  approveExpenses: boolean;
  workspaces: Record<Workspace, boolean>;
}

export function permissionSetFor(a: Who): PermissionSet {
  return {
    manageUsers: canManageUsers(a),
    manageSettings: canManageSettings(a),
    manageProduction: canManageProduction(a),
    approveContent: canApproveContent(a),
    viewAllExpenses: canViewAllExpenses(a),
    approveExpenses: canApproveExpenses(a),
    workspaces: {
      admin: canAccessWorkspace(a, Workspace.ADMIN),
      work: canAccessWorkspace(a, Workspace.WORK),
      client: canAccessWorkspace(a, Workspace.CLIENT),
    },
  };
}
