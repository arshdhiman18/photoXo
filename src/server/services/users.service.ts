import "server-only";
import { env } from "@/lib/env";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { SystemRole, UserStatus, type InvitableRole } from "@/lib/domain/roles";
import { TEAM_PAGE_SIZE, type TeamListQuery } from "@/features/team/schemas";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, NotFoundError } from "@/server/authz/errors";
import {
  assertCan,
  canAdministerUser,
  canAssignRole,
  canManageUsers,
  canViewTeamDirectory,
} from "@/server/authz/permissions";
import { generateToken } from "@/server/auth/tokens";
import { hasCredentialAccount, revokeAllSessions } from "@/server/auth/sessions";
import type { InviteLinkDTO, TeamListData, TeamMemberDTO } from "@/features/team/types";
import { toTeamMemberDTO } from "@/server/dto/users";
import { sendInvitationEmail } from "@/server/email/templates";
import { EmailDeliveryError } from "@/server/email/transport";

import { getOwnAgency } from "@/server/repositories/agency.repo";
import {
  createInvitation,
  latestInvitationsFor,
  revokeOpenInvitations,
} from "@/server/repositories/invitations.repo";
import {
  countUsersByStatus,
  emailIsTaken,
  insertUser,
  usersRepo,
} from "@/server/repositories/users.repo";
import type { UserDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import type { Types } from "mongoose";
import {
  BRAND_ROLE_LABEL,
  BRAND_ROLE_ORDER,
  BrandStatus,
  isRoleCompatible,
} from "@/lib/domain/brands";
import type { MemberBrandDTO } from "@/features/team/types";
import { brandSummaries } from "@/server/repositories/brands.repo";
import {
  activeMembershipsForUsers,
  activeRolesForUser,
} from "@/server/repositories/memberships.repo";

export const INVITATION_TTL_DAYS = 7;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Queries ────────────────────────────────────────────────────────────────

export async function listTeam(actor: Actor, query: TeamListQuery): Promise<TeamListData> {
  assertCan(canManageUsers(actor));

  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }

  const page = query.page ?? 1;
  const [docs, total, statusCounts] = await Promise.all([
    usersRepo.find(actor, filter, {
      sort: { createdAt: -1 },
      skip: (page - 1) * TEAM_PAGE_SIZE,
      limit: TEAM_PAGE_SIZE,
    }),
    usersRepo.count(actor, filter),
    countUsersByStatus(actor.agencyId),
  ]);

  const invited = docs.filter((d) => d.status === UserStatus.INVITED).map((d) => d._id);
  const [invitations, brandsByUser] = await Promise.all([
    invited.length ? latestInvitationsFor(actor.agencyId, invited) : Promise.resolve(new Map()),
    brandChipsFor(
      actor.agencyId,
      docs.map((d) => d._id),
    ),
  ]);

  return {
    items: docs.map((d) =>
      toTeamMemberDTO(d, {
        selfId: actor.userId,
        invitation: d.status === UserStatus.INVITED ? invitations.get(String(d._id)) : null,
        brands: brandsByUser.get(String(d._id)) ?? [],
      }),
    ),
    total,
    page,
    pageSize: TEAM_PAGE_SIZE,
    statusCounts,
  };
}

/** userId → active brand assignments (2 queries for the whole page, no N+1). */
async function brandChipsFor(
  agencyId: string,
  userIds: Types.ObjectId[],
): Promise<Map<string, MemberBrandDTO[]>> {
  const memberships = await activeMembershipsForUsers(agencyId, userIds);
  const brands = await brandSummaries(agencyId, [...new Set(memberships.map((m) => m.brandId))]);
  const out = new Map<string, Map<string, MemberBrandDTO>>();
  for (const m of memberships) {
    const b = brands.get(String(m.brandId));
    if (!b) continue;
    const perUser = out.get(String(m.userId)) ?? new Map<string, MemberBrandDTO>();
    const chip = perUser.get(b.id) ?? {
      id: b.id,
      name: b.name,
      archived: b.status === BrandStatus.ARCHIVED,
      roles: [],
    };
    chip.roles.push(m.role);
    perUser.set(b.id, chip);
    out.set(String(m.userId), perUser);
  }
  return new Map(
    [...out].map(([userId, perUser]) => [
      userId,
      [...perUser.values()]
        .map((c) => ({ ...c, roles: BRAND_ROLE_ORDER.filter((r) => c.roles.includes(r)) }))
        .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name)),
    ]),
  );
}

// ── Invitations ────────────────────────────────────────────────────────────

async function issueInvitation(actor: Actor, user: UserDoc): Promise<InviteLinkDTO> {
  const agency = await getOwnAgency(actor);
  if (!agency) throw new NotFoundError();

  await revokeOpenInvitations(actor.agencyId, String(user._id));
  const { token, hash } = generateToken();
  await createInvitation({
    agencyId: actor.agencyId,
    userId: String(user._id),
    email: user.email,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    invitedBy: actor.userId,
  });

  const url = `${env.APP_URL}/invite/${token}`;
  const link = { url, expiresInDays: INVITATION_TTL_DAYS, agencyName: agency.name };
  // Email is best-effort: the admin always gets the link to share directly.
  try {
    const delivery = await sendInvitationEmail({
      to: user.email,
      name: user.name,
      role: user.role,
      agencyName: agency.name,
      inviterName: actor.name,
      url,
      expiresInDays: INVITATION_TTL_DAYS,
    });
    return { ...link, delivery: delivery.status };
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      console.error("[invite] email delivery failed", error.message);
      return { ...link, delivery: "failed" };
    }
    throw error;
  }
}

export async function inviteUser(
  actor: Actor,
  input: { name: string; email: string; role: InvitableRole },
): Promise<{ user: TeamMemberDTO; invite: InviteLinkDTO }> {
  assertCan(canManageUsers(actor));
  assertCan(canAssignRole(actor, input.role), "That role can't be assigned here.");

  if (await emailIsTaken(input.email)) {
    throw new ConflictError("Someone with this email already has an account.");
  }

  let user: UserDoc;
  try {
    user = await insertUser({
      agencyId: actor.agencyId,
      name: input.name,
      email: input.email,
      emailVerified: false,
      image: null,
      role: input.role,
      status: UserStatus.INVITED,
      invitedBy: actor.userId,
      invitedAt: new Date(),
      activatedAt: null,
      suspendedAt: null,
      deactivatedAt: null,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ConflictError("Someone with this email already has an account.");
    }
    throw error;
  }

  await recordActivity({
    actor,
    action: ActivityAction.USER_INVITED,
    entity: { kind: ActivityEntityKind.USER, id: String(user._id) },
    meta: { role: input.role, email: input.email },
  });

  const invite = await issueInvitation(actor, user);
  return { user: toTeamMemberDTO(user, { selfId: actor.userId }), invite };
}

/** Loads a target user the actor is allowed to administer (else 404/403). */
async function loadAdministrableUser(actor: Actor, userId: string): Promise<UserDoc> {
  assertCan(canManageUsers(actor));
  const target = await usersRepo.getById(actor, userId); // NotFound outside scope
  assertCan(
    canAdministerUser(actor, { id: String(target._id), role: target.role }),
    target.role === SystemRole.ADMIN
      ? "Admin accounts can't be changed from the Team page."
      : "You can't change your own account here.",
  );
  return target;
}

export async function resendInvitation(actor: Actor, userId: string): Promise<{ invite: InviteLinkDTO }> {
  const target = await loadAdministrableUser(actor, userId);
  if (target.status !== UserStatus.INVITED) {
    throw new ConflictError("Only pending invitations can be resent.");
  }
  const invite = await issueInvitation(actor, target);
  await recordActivity({
    actor,
    action: ActivityAction.USER_INVITE_RESENT,
    entity: { kind: ActivityEntityKind.USER, id: userId },
  });
  return { invite };
}

export async function revokeInvitation(actor: Actor, userId: string) {
  await loadAdministrableUser(actor, userId);
  await withTransaction(async () => {
    const updated = await usersRepo.updateById(
      actor,
      userId,
      { $set: { status: UserStatus.DEACTIVATED, deactivatedAt: new Date() } },
      { status: UserStatus.INVITED },
    );
    if (!updated) throw new ConflictError("This invitation is no longer pending.");
    await revokeOpenInvitations(actor.agencyId, userId);
    await recordActivity({
      actor,
      action: ActivityAction.USER_INVITE_REVOKED,
      entity: { kind: ActivityEntityKind.USER, id: userId },
    });
  });
}

// ── Account state transitions (conditional updates; race-safe) ────────────

export async function suspendUser(actor: Actor, userId: string) {
  await loadAdministrableUser(actor, userId);
  await withTransaction(async () => {
    const updated = await usersRepo.updateById(
      actor,
      userId,
      { $set: { status: UserStatus.SUSPENDED, suspendedAt: new Date() } },
      { status: UserStatus.ACTIVE },
    );
    if (!updated) throw new ConflictError("Only active users can be suspended.");
    await recordActivity({
      actor,
      action: ActivityAction.USER_SUSPENDED,
      entity: { kind: ActivityEntityKind.USER, id: userId },
    });
  });
  // After commit. Even if this failed, the Actor check rejects non-ACTIVE users.
  await revokeAllSessions(userId);
}

export async function deactivateUser(actor: Actor, userId: string) {
  await loadAdministrableUser(actor, userId);
  await withTransaction(async () => {
    const updated = await usersRepo.updateById(
      actor,
      userId,
      { $set: { status: UserStatus.DEACTIVATED, deactivatedAt: new Date() } },
      { status: { $in: [UserStatus.ACTIVE, UserStatus.SUSPENDED] } },
    );
    if (!updated) throw new ConflictError("Only active or suspended users can be deactivated.");
    await revokeOpenInvitations(actor.agencyId, userId);
    await recordActivity({
      actor,
      action: ActivityAction.USER_DEACTIVATED,
      entity: { kind: ActivityEntityKind.USER, id: userId },
    });
  });
  await revokeAllSessions(userId);
}

/**
 * Suspended/deactivated → ACTIVE if the person had completed setup, otherwise
 * back to INVITED (admin then resends the invitation).
 */
export async function reactivateUser(
  actor: Actor,
  userId: string,
): Promise<{ status: UserStatus }> {
  await loadAdministrableUser(actor, userId);
  const nextStatus = (await hasCredentialAccount(userId)) ? UserStatus.ACTIVE : UserStatus.INVITED;
  await withTransaction(async () => {
    const updated = await usersRepo.updateById(
      actor,
      userId,
      { $set: { status: nextStatus, suspendedAt: null, deactivatedAt: null } },
      { status: { $in: [UserStatus.SUSPENDED, UserStatus.DEACTIVATED] } },
    );
    if (!updated) {
      throw new ConflictError("Only suspended or deactivated users can be reactivated.");
    }
    await recordActivity({
      actor,
      action: ActivityAction.USER_REACTIVATED,
      entity: { kind: ActivityEntityKind.USER, id: userId },
      meta: { status: nextStatus },
    });
  });
  return { status: nextStatus };
}

export async function changeUserRole(actor: Actor, userId: string, role: InvitableRole) {
  const target = await loadAdministrableUser(actor, userId);
  assertCan(canAssignRole(actor, role), "That role can't be assigned here.");
  if (target.role === role) return;

  // System role and brand roles must stay compatible (e.g. a STAFF videographer
  // can't silently become a CLIENT while holding production assignments).
  const conflicting = (await activeRolesForUser(actor.agencyId, userId)).filter(
    (r) => !isRoleCompatible(role, r),
  );
  if (conflicting.length) {
    throw new ConflictError(
      `Remove their brand assignments first (${conflicting.map((r) => BRAND_ROLE_LABEL[r]).join(", ")}).`,
    );
  }
  await withTransaction(async () => {
    const updated = await usersRepo.updateById(
      actor,
      userId,
      { $set: { role } },
      { role: target.role }, // optimistic: role unchanged since we read it
    );
    if (!updated) {
      throw new ConflictError("This user was changed by someone else. Refresh and try again.");
    }
    await recordActivity({
      actor,
      action: ActivityAction.USER_ROLE_CHANGED,
      entity: { kind: ActivityEntityKind.USER, id: userId },
      meta: { from: target.role, to: role },
    });
  });
}

/** Internal people for crew filters (name only). ADMIN/MANAGER. */
export async function listCrewPeople(actor: Actor): Promise<{ id: string; name: string }[]> {
  if (!canViewTeamDirectory(actor)) return [];
  const users = await usersRepo.find(
    actor,
    { role: { $in: [SystemRole.STAFF, SystemRole.MANAGER] }, status: UserStatus.ACTIVE },
    { sort: { name: 1 }, limit: 200, projection: { name: 1 } },
  );
  return users.map((u) => ({ id: String(u._id), name: u.name }));
}
