import "server-only";
import { cache } from "react";
import type { Types } from "mongoose";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { BrandStatus } from "@/lib/domain/brands";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import {
  BRAND_PAGE_SIZE,
  type BrandListQuery,
  type createBrandSchema,
  type updateBrandSchema,
} from "@/features/brands/schemas";
import type {
  BrandDetailDTO,
  BrandListData,
  BrandPublicDTO,
  MyBrandDTO,
} from "@/features/brands/types";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, NotFoundError } from "@/server/authz/errors";
import { assertCan, canDeleteBrands, canManageBrands } from "@/server/authz/permissions";
import type { BrandDoc } from "@/server/db/models";
import { toBrandDetailDTO, toBrandPublicDTO, toSocialHandleDTO } from "@/server/dto/brands";
import {
  brandNameKey,
  brandNameTaken,
  brandsRepo,
  DuplicateBrandNameError,
  DuplicateSlugError,
  insertBrand,
} from "@/server/repositories/brands.repo";
import { memberCountsByBrand, membershipsRepo } from "@/server/repositories/memberships.repo";
import { usersRepo } from "@/server/repositories/users.repo";
import { brandDeletionBlockers, hasBlockers, purgeBrand } from "@/server/repositories/deletion.repo";
import { describeBlockers } from "./deletion-messages";
import { withTransaction } from "@/server/db/transaction";
import { asObjectId } from "@/server/repositories/scoped-repository";
import type { z } from "zod";

type CreateBrand = z.output<typeof createBrandSchema>;
type UpdateBrand = z.output<typeof updateBrandSchema>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DUPLICATE_NAME = "A brand with this name already exists.";

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * The single entry point for loading a brand by id. Visibility-scoped: an id
 * outside the actor's brands (or agency) is a 404, never a leak. Memoised per
 * request so layout + page share one query.
 */
export const getVisibleBrand = cache(async (actor: Actor, brandId: string): Promise<BrandDoc> => {
  return brandsRepo.getById(actor, brandId);
});

export async function getBrandForAdmin(actor: Actor, brandId: string): Promise<BrandDetailDTO> {
  assertCan(canManageBrands(actor));
  return toBrandDetailDTO(await getVisibleBrand(actor, brandId));
}

/** Staff/client view of a visible brand: identity fields only. */
export async function getBrandPublic(actor: Actor, brandId: string): Promise<BrandPublicDTO> {
  return toBrandPublicDTO(await getVisibleBrand(actor, brandId));
}

export async function listBrands(actor: Actor, query: BrandListQuery): Promise<BrandListData> {
  assertCan(canManageBrands(actor));

  const status = query.status ?? "ACTIVE";
  const filter: Record<string, unknown> = {};
  if (status !== "ALL") filter.status = status;
  if (query.q) filter.name = new RegExp(escapeRegex(query.q), "i");

  const page = query.page ?? 1;
  const [docs, total, active, archived] = await Promise.all([
    brandsRepo.find(actor, filter, {
      sort: { name: 1 },
      skip: (page - 1) * BRAND_PAGE_SIZE,
      limit: BRAND_PAGE_SIZE,
    }),
    brandsRepo.count(actor, filter),
    brandsRepo.count(actor, { status: BrandStatus.ACTIVE }),
    brandsRepo.count(actor, { status: BrandStatus.ARCHIVED }),
  ]);

  const ids = docs.map((d) => d._id);
  const uploaderIds = docs.map((d) => d.primaryUploaderId).filter((x): x is Types.ObjectId => !!x);
  const [counts, uploaders] = await Promise.all([
    memberCountsByBrand(actor.agencyId, ids),
    uploaderIds.length
      ? usersRepo.find(
          actor,
          { _id: { $in: uploaderIds } },
          { projection: { name: 1 }, limit: 200 },
        )
      : Promise.resolve([]),
  ]);
  const uploaderName = new Map(uploaders.map((u) => [String(u._id), u.name]));

  return {
    items: docs.map((b) => {
      const c = counts.get(String(b._id));
      const pu = b.primaryUploaderId ? String(b.primaryUploaderId) : null;
      return {
        id: String(b._id),
        name: b.name,
        slug: b.slug,
        logoUrl: b.logo?.url ?? null,
        status: b.status,
        socialHandles: b.socialHandles.map(toSocialHandleDTO),
        teamCount: c?.team ?? 0,
        clientCount: c?.clients ?? 0,
        primaryUploader: pu ? { id: pu, name: uploaderName.get(pu) ?? "Unknown" } : null,
        updatedAt: b.updatedAt.toISOString(),
      };
    }),
    total,
    page,
    pageSize: BRAND_PAGE_SIZE,
    statusCounts: { ACTIVE: active, ARCHIVED: archived },
  };
}

/**
 * Brands the actor belongs to, with their own roles (staff "My brands",
 * client brand context). Active brands only.
 */
export async function listMyBrands(actor: Actor): Promise<MyBrandDTO[]> {
  const memberships = await membershipsRepo.find(
    actor,
    { userId: asObjectId(actor.userId), status: "ACTIVE" },
    { limit: 200, projection: { brandId: 1, role: 1 } },
  );
  const roles = new Map<string, BrandRole[]>();
  for (const m of memberships) {
    if (actor.systemRole === SystemRole.CLIENT && m.role !== BrandRole.CLIENT) continue;
    const k = String(m.brandId);
    roles.set(k, [...(roles.get(k) ?? []), m.role]);
  }
  if (roles.size === 0) return [];
  const brands = await brandsRepo.find(
    actor,
    { _id: { $in: [...roles.keys()].map(asObjectId) }, status: BrandStatus.ACTIVE },
    { sort: { name: 1 }, limit: 200 },
  );
  return brands.map((b) => ({ ...toBrandPublicDTO(b), myRoles: roles.get(String(b._id)) ?? [] }));
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function createBrand(actor: Actor, input: CreateBrand): Promise<{ id: string }> {
  assertCan(canManageBrands(actor));
  const nameKey = brandNameKey(input.name);
  if (await brandNameTaken(actor.agencyId, nameKey)) throw new ConflictError(DUPLICATE_NAME);

  // Brand + audit entry commit atomically. A slug race aborts the transaction,
  // so retries happen around it (each attempt picks the next free slug).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const brand = await withTransaction(async () => {
        const created = await insertBrand({
          agencyId: actor.agencyId,
          createdBy: actor.userId,
          name: input.name,
          nameKey,
          description: input.description,
          logo: input.logoUrl ? { url: input.logoUrl } : null,
          status: input.status,
          socialHandles: input.socialHandles,
          primaryUploaderId: null,
          codePrefix: null,
          archivedAt: input.status === BrandStatus.ARCHIVED ? new Date() : null,
        });
        await recordActivity({
          actor,
          action: ActivityAction.BRAND_CREATED,
          entity: { kind: ActivityEntityKind.BRAND, id: String(created._id) },
          brandId: String(created._id),
          meta: { name: created.name, slug: created.slug, status: created.status },
        });
        return created;
      });
      return { id: String(brand._id) };
    } catch (error) {
      if (error instanceof DuplicateBrandNameError) throw new ConflictError(DUPLICATE_NAME);
      if (error instanceof DuplicateSlugError) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not create the brand right now. Please try again.");
}

export async function updateBrand(actor: Actor, input: UpdateBrand): Promise<BrandDetailDTO> {
  assertCan(canManageBrands(actor));
  const before = await getVisibleBrand(actor, input.brandId);
  const nameKey = brandNameKey(input.name);
  if (
    nameKey !== before.nameKey &&
    (await brandNameTaken(actor.agencyId, nameKey, input.brandId))
  ) {
    throw new ConflictError(DUPLICATE_NAME);
  }

  try {
    const updated = await withTransaction(async () => {
      const doc = await brandsRepo.updateById(actor, input.brandId, {
        $set: {
          name: input.name,
          nameKey,
          description: input.description,
          logo: input.logoUrl ? { url: input.logoUrl } : null,
          socialHandles: input.socialHandles,
        },
      });
      if (!doc) throw new ConflictError("This brand changed. Refresh and try again.");

      const changed: string[] = (["name", "description"] as const).filter(
        (k) => before[k] !== doc[k],
      );
      if ((before.logo?.url ?? null) !== (doc.logo?.url ?? null)) changed.push("logo");
      if (JSON.stringify(before.socialHandles) !== JSON.stringify(doc.socialHandles)) {
        changed.push("socialHandles");
      }
      if (changed.length) {
        await recordActivity({
          actor,
          action: ActivityAction.BRAND_UPDATED,
          entity: { kind: ActivityEntityKind.BRAND, id: input.brandId },
          brandId: input.brandId,
          meta: {
            fields: changed,
            ...(changed.includes("name") ? { from: before.name, to: doc.name } : {}),
          },
        });
      }
      return doc;
    });
    return toBrandDetailDTO(updated);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ConflictError(DUPLICATE_NAME);
    throw error;
  }
}

export async function archiveBrand(actor: Actor, brandId: string): Promise<void> {
  assertCan(canManageBrands(actor));
  await getVisibleBrand(actor, brandId); // 404 if not visible
  await withTransaction(async () => {
    const updated = await brandsRepo.updateById(
      actor,
      brandId,
      { $set: { status: BrandStatus.ARCHIVED, archivedAt: new Date() } },
      { status: BrandStatus.ACTIVE },
    );
    if (!updated) throw new ConflictError("Only active brands can be archived.");
    await recordActivity({
      actor,
      action: ActivityAction.BRAND_ARCHIVED,
      entity: { kind: ActivityEntityKind.BRAND, id: brandId },
      brandId,
    });
  });
}

export async function reactivateBrand(actor: Actor, brandId: string): Promise<void> {
  assertCan(canManageBrands(actor));
  await getVisibleBrand(actor, brandId);
  await withTransaction(async () => {
    const updated = await brandsRepo.updateById(
      actor,
      brandId,
      { $set: { status: BrandStatus.ACTIVE, archivedAt: null } },
      { status: BrandStatus.ARCHIVED },
    );
    if (!updated) throw new ConflictError("Only archived brands can be reactivated.");
    await recordActivity({
      actor,
      action: ActivityAction.BRAND_REACTIVATED,
      entity: { kind: ActivityEntityKind.BRAND, id: brandId },
      brandId,
    });
  });
}

/** Active brands for pickers (content creation, filters). Ops see all; staff their own. */
export async function listBrandOptions(actor: Actor): Promise<{ id: string; name: string }[]> {
  const brands = await brandsRepo.find(
    actor,
    { status: BrandStatus.ACTIVE },
    { sort: { name: 1 }, limit: 200, projection: { name: 1 } },
  );
  return brands.map((b) => ({ id: String(b._id), name: b.name }));
}

/**
 * Permanently delete a brand created by mistake (ADMIN). Only while it has no
 * content, shoots, expenses or files; its team assignments and reference
 * library go with it. Brands with history are archived instead.
 */
export async function deleteBrand(actor: Actor, brandId: string): Promise<void> {
  assertCan(canDeleteBrands(actor));
  const brand = await getVisibleBrand(actor, brandId);
  const blockers = await brandDeletionBlockers(actor.agencyId, brandId);
  if (hasBlockers(blockers)) {
    throw new ConflictError(`${brand.name} has ${describeBlockers(blockers)}, so it can't be deleted. Archive it instead.`);
  }
  await withTransaction(async () => {
    if (!(await purgeBrand(actor.agencyId, brandId))) throw new NotFoundError();
    await recordActivity({
      actor,
      action: ActivityAction.BRAND_DELETED,
      entity: { kind: ActivityEntityKind.BRAND, id: brandId },
      meta: { name: brand.name },
    });
  });
}

/** Whether the Delete button should be offered (ADMIN, brand without history). */
export async function getBrandDeletion(actor: Actor, brandId: string): Promise<{ deletable: boolean; reason: string | null }> {
  if (!canDeleteBrands(actor)) return { deletable: false, reason: null };
  await getVisibleBrand(actor, brandId);
  const blockers = await brandDeletionBlockers(actor.agencyId, brandId);
  return hasBlockers(blockers)
    ? { deletable: false, reason: `It has ${describeBlockers(blockers)}.` }
    : { deletable: true, reason: null };
}
