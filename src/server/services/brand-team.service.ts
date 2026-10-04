import "server-only";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import {
  ASSIGNABLE_USER_STATUSES,
  BRAND_ROLE_ORDER,
  BRAND_ROLE_ALLOWED_SYSTEM_ROLES,
  BRAND_ROLE_LABEL,
  BrandStatus,
  isRoleCompatible,
  MembershipStatus,
} from "@/lib/domain/brands";
import {
  BrandRole,
  SYSTEM_ROLE_LABEL,
  UserStatus,
  type BrandRole as BrandRoleT,
} from "@/lib/domain/roles";
import type {
  BrandMemberDTO,
  BrandTeamDTO,
  CoworkerDTO,
  MemberCandidateDTO,
} from "@/features/brands/types";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { assertCan, canManageBrandTeam, canViewCoworkers } from "@/server/authz/permissions";
import type { BrandDoc } from "@/server/db/models";
import { brandsRepo } from "@/server/repositories/brands.repo";
import {
  activateMembership,
  deactivateMembership,
  listBrandMembers,
  listCoworkers,
  membershipsRepo,
  type MemberRow,
} from "@/server/repositories/memberships.repo";
import { usersRepo } from "@/server/repositories/users.repo";
import { withTransaction } from "@/server/db/transaction";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { getVisibleBrand } from "./brands.service";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Loads a brand the actor may manage the team of. Archived brands are read-only. */
async function loadManageableBrand(
  actor: Actor,
  brandId: string,
  opts: { requireActive?: boolean } = {},
): Promise<BrandDoc> {
  assertCan(canManageBrandTeam(actor));
  const brand = await getVisibleBrand(actor, brandId); // 404 outside scope / agency
  if (opts.requireActive && brand.status !== BrandStatus.ACTIVE) {
    throw new ConflictError("This brand is archived. Reactivate it to change its team.");
  }
  return brand;
}

/** Loads a membership and proves it belongs to the brand in the request. */
async function loadMembership(actor: Actor, brandId: string, membershipId: string) {
  const m = await membershipsRepo.getById(actor, membershipId);
  if (String(m.brandId) !== brandId) throw new NotFoundError();
  return m;
}

function toMemberDTO(row: MemberRow, primaryUploaderId: string | null): BrandMemberDTO {
  return {
    membershipId: String(row.membershipId),
    userId: String(row.user._id),
    name: row.user.name,
    email: row.user.email,
    image: row.user.image ?? null,
    systemRole: row.user.role,
    userStatus: row.user.status,
    role: row.role,
    status: row.status,
    isPrimaryUploader:
      row.role === BrandRole.UPLOADER &&
      row.status === MembershipStatus.ACTIVE &&
      String(row.user._id) === primaryUploaderId,
    since: row.activatedAt.toISOString(),
    until: row.deactivatedAt?.toISOString() ?? null,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getBrandTeam(actor: Actor, brandId: string): Promise<BrandTeamDTO> {
  const brand = await loadManageableBrand(actor, brandId);
  const rows = await listBrandMembers(actor.agencyId, brandId);
  const primary = brand.primaryUploaderId ? String(brand.primaryUploaderId) : null;
  const dtos = rows.map((r) => toMemberDTO(r, primary));
  const active = dtos.filter((m) => m.status === MembershipStatus.ACTIVE);

  const primaryRow = active.find((m) => m.isPrimaryUploader);
  return {
    groups: BRAND_ROLE_ORDER.map((role) => ({
      role,
      members: active
        .filter((m) => m.role === role)
        .sort((a, b) => Number(b.isPrimaryUploader) - Number(a.isPrimaryUploader)),
    })),
    inactive: dtos.filter((m) => m.status === MembershipStatus.INACTIVE),
    primaryUploaderId: primary,
    primaryUploaderUnavailable: Boolean(primaryRow && primaryRow.userStatus !== UserStatus.ACTIVE),
    activeMemberCount: new Set(active.map((m) => m.userId)).size,
  };
}

/**
 * Coworker view for anyone internal who can see the brand. Staff only reach
 * brands they belong to (scope → 404 otherwise). Clients never see the team.
 */
export async function getCoworkers(actor: Actor, brandId: string): Promise<CoworkerDTO[]> {
  assertCan(canViewCoworkers(actor));
  await getVisibleBrand(actor, brandId);
  const rows = await listCoworkers(actor.agencyId, brandId);
  return rows.map((r) => ({
    userId: String(r.userId),
    name: r.name,
    image: r.image ?? null,
    roles: BRAND_ROLE_ORDER.filter((role) => r.roles.includes(role)),
    isYou: String(r.userId) === actor.userId,
  }));
}

/**
 * People who may be given `role` on this brand: compatible system role,
 * assignable account status, not already holding that role here. Searched
 * server-side and capped — never loads the whole agency.
 */
export async function searchMemberCandidates(
  actor: Actor,
  input: { brandId: string; role: BrandRoleT; q: string },
): Promise<MemberCandidateDTO[]> {
  await loadManageableBrand(actor, input.brandId);
  const taken = await membershipsRepo.find(
    actor,
    { brandId: asObjectId(input.brandId), role: input.role, status: MembershipStatus.ACTIVE },
    { projection: { userId: 1 }, limit: 200 },
  );
  const filter: Record<string, unknown> = {
    role: { $in: BRAND_ROLE_ALLOWED_SYSTEM_ROLES[input.role] },
    status: { $in: ASSIGNABLE_USER_STATUSES },
    _id: { $nin: taken.map((m) => m.userId) },
  };
  if (input.q) {
    const rx = new RegExp(escapeRegex(input.q), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const users = await usersRepo.find(actor, filter, {
    sort: { name: 1 },
    limit: 20,
    projection: { name: 1, email: 1, image: 1, role: 1, status: 1 },
  });
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    systemRole: u.role,
    userStatus: u.status,
  }));
}

// ── Writes ─────────────────────────────────────────────────────────────────

async function assertAssignable(actor: Actor, userId: string, role: BrandRoleT) {
  const user = await usersRepo.findById(actor, userId); // agency-scoped
  if (!user) throw new NotFoundError("That person isn't in your agency.");
  if (!ASSIGNABLE_USER_STATUSES.includes(user.status)) {
    throw new ConflictError("Only active or invited people can be assigned to a brand.");
  }
  if (!isRoleCompatible(user.role, role)) {
    throw new ValidationError(
      `${SYSTEM_ROLE_LABEL[user.role]} accounts can't be given the ${BRAND_ROLE_LABEL[role]} role.`,
      { role: ["Not allowed for this person's account type"] },
    );
  }
  return user;
}

/** Keeps Brand.primaryUploaderId consistent with UPLOADER memberships. */
async function setPrimaryUploaderInternal(
  actor: Actor,
  brand: BrandDoc,
  userId: string | null,
  reason: "manual" | "auto_first_uploader" | "uploader_removed",
) {
  const from = brand.primaryUploaderId ? String(brand.primaryUploaderId) : null;
  if (from === userId) return;
  const updated = await brandsRepo.updateById(
    actor,
    String(brand._id),
    { $set: { primaryUploaderId: userId ? asObjectId(userId) : null } },
    { primaryUploaderId: brand.primaryUploaderId }, // optimistic
  );
  if (!updated) throw new ConflictError("This brand changed. Refresh and try again.");
  brand.primaryUploaderId = updated.primaryUploaderId;
  await recordActivity({
    actor,
    action: ActivityAction.BRAND_PRIMARY_UPLOADER_CHANGED,
    entity: { kind: ActivityEntityKind.BRAND, id: String(brand._id) },
    brandId: String(brand._id),
    meta: { from, to: userId, reason },
  });
}

/** After an UPLOADER membership goes away, clear the primary if it was them. */
async function afterUploaderRemoved(actor: Actor, brand: BrandDoc, userId: string) {
  if (brand.primaryUploaderId && String(brand.primaryUploaderId) === userId) {
    await setPrimaryUploaderInternal(actor, brand, null, "uploader_removed");
  }
}

export async function addMember(
  actor: Actor,
  input: { brandId: string; userId: string; role: BrandRoleT },
): Promise<{ membershipId: string; outcome: "created" | "reactivated" | "unchanged" }> {
  const brand = await loadManageableBrand(actor, input.brandId, { requireActive: true });
  await assertAssignable(actor, input.userId, input.role);

  // Membership, audit entry and primary-uploader update commit atomically.
  return withTransaction(async () => {
    const { membership, outcome } = await activateMembership({
      agencyId: actor.agencyId,
      brandId: input.brandId,
      userId: input.userId,
      role: input.role,
      actorId: actor.userId,
    });
    if (outcome === "unchanged") {
      throw new ConflictError(`Already assigned as ${BRAND_ROLE_LABEL[input.role]}.`);
    }

    await recordActivity({
      actor,
      action:
        outcome === "created"
          ? ActivityAction.MEMBERSHIP_ADDED
          : ActivityAction.MEMBERSHIP_REACTIVATED,
      entity: { kind: ActivityEntityKind.BRAND_MEMBERSHIP, id: String(membership._id) },
      brandId: input.brandId,
      meta: { userId: input.userId, role: input.role },
    });

    // First uploader on a brand becomes the default automatically.
    if (input.role === BrandRole.UPLOADER && !brand.primaryUploaderId) {
      await setPrimaryUploaderInternal(actor, brand, input.userId, "auto_first_uploader");
    }
    return { membershipId: String(membership._id), outcome };
  });
}

export async function deactivateMember(
  actor: Actor,
  input: { brandId: string; membershipId: string },
): Promise<void> {
  const brand = await loadManageableBrand(actor, input.brandId);
  const m = await loadMembership(actor, input.brandId, input.membershipId);
  await withTransaction(async () => {
    const updated = await deactivateMembership(actor.agencyId, input.membershipId, actor.userId);
    if (!updated) throw new ConflictError("This assignment is already inactive.");
    await recordActivity({
      actor,
      action: ActivityAction.MEMBERSHIP_DEACTIVATED,
      entity: { kind: ActivityEntityKind.BRAND_MEMBERSHIP, id: input.membershipId },
      brandId: input.brandId,
      meta: { userId: String(m.userId), role: m.role },
    });
    if (m.role === BrandRole.UPLOADER) await afterUploaderRemoved(actor, brand, String(m.userId));
  });
}

export async function reactivateMember(
  actor: Actor,
  input: { brandId: string; membershipId: string },
): Promise<void> {
  await loadManageableBrand(actor, input.brandId, { requireActive: true });
  const m = await loadMembership(actor, input.brandId, input.membershipId);
  if (m.status === MembershipStatus.ACTIVE)
    throw new ConflictError("This assignment is already active.");
  // addMember re-validates compatibility (the person's account may have changed)
  // and records MEMBERSHIP_REACTIVATED.
  await addMember(actor, { brandId: input.brandId, userId: String(m.userId), role: m.role });
}

/**
 * Role change = deactivate the old (brand, user, role) row and activate the
 * new one. Each role keeps its own history; nothing is overwritten.
 */
export async function changeMemberRole(
  actor: Actor,
  input: { brandId: string; membershipId: string; role: BrandRoleT },
): Promise<{ membershipId: string }> {
  const brand = await loadManageableBrand(actor, input.brandId, { requireActive: true });
  const m = await loadMembership(actor, input.brandId, input.membershipId);
  if (m.status !== MembershipStatus.ACTIVE)
    throw new ConflictError("Reactivate this assignment first.");
  if (m.role === input.role) return { membershipId: input.membershipId };
  await assertAssignable(actor, String(m.userId), input.role);

  return withTransaction(async () => {
    const { membership, outcome } = await activateMembership({
      agencyId: actor.agencyId,
      brandId: input.brandId,
      userId: String(m.userId),
      role: input.role,
      actorId: actor.userId,
    });
    if (outcome === "unchanged") {
      throw new ConflictError(
        `This person is already ${BRAND_ROLE_LABEL[input.role]} on this brand.`,
      );
    }
    await deactivateMembership(actor.agencyId, input.membershipId, actor.userId);

    await recordActivity({
      actor,
      action: ActivityAction.MEMBERSHIP_ROLE_CHANGED,
      entity: { kind: ActivityEntityKind.BRAND_MEMBERSHIP, id: String(membership._id) },
      brandId: input.brandId,
      meta: {
        userId: String(m.userId),
        from: m.role,
        to: input.role,
        previousMembershipId: input.membershipId,
      },
    });

    if (m.role === BrandRole.UPLOADER) await afterUploaderRemoved(actor, brand, String(m.userId));
    if (input.role === BrandRole.UPLOADER && !brand.primaryUploaderId) {
      await setPrimaryUploaderInternal(actor, brand, String(m.userId), "auto_first_uploader");
    }
    return { membershipId: String(membership._id) };
  });
}

/** Set (or clear) the brand's default Content Uploader. Must hold an ACTIVE UPLOADER membership. */
export async function setPrimaryUploader(
  actor: Actor,
  input: { brandId: string; userId: string | null },
): Promise<void> {
  const brand = await loadManageableBrand(actor, input.brandId, { requireActive: true });
  if (input.userId) {
    const uploader = await membershipsRepo.find(
      actor,
      {
        brandId: brand._id,
        userId: asObjectId(input.userId),
        role: BrandRole.UPLOADER,
        status: MembershipStatus.ACTIVE,
      },
      { limit: 1 },
    );
    if (uploader.length === 0) {
      throw new ConflictError(
        "Only an active Content Uploader on this brand can be the primary uploader.",
      );
    }
  }
  await withTransaction(() => setPrimaryUploaderInternal(actor, brand, input.userId, "manual"));
}
