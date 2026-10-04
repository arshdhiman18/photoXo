import "server-only";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { BrandStatus } from "@/lib/domain/brands";
import { parseReferenceUrl } from "@/lib/domain/references";
import type { ReferenceDTO } from "@/features/content/types";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, ForbiddenError } from "@/server/authz/errors";
import { assertCan, canManageContent, canProposeIdeas } from "@/server/authz/permissions";
import type { BrandDoc, ReferenceDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { toReferenceDTO } from "@/server/dto/content";
import { brandsRepo } from "@/server/repositories/brands.repo";
import { insertReference, referencesRepo } from "@/server/repositories/content.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";

/**
 * Create a reference inside the caller's transaction. Only the URL and
 * platform id are stored — social media is never downloaded.
 */
export async function createReferenceInTx(
  actor: Actor,
  brand: BrandDoc,
  input: { url: string; title: string | null; notes: string | null },
): Promise<ReferenceDoc> {
  const parsed = parseReferenceUrl(input.url);
  const ref = await insertReference({
    agencyId: brand.agencyId,
    brandId: brand._id,
    platform: parsed.platform,
    url: parsed.url,
    externalId: parsed.externalId,
    variant: parsed.variant,
    title: input.title,
    notes: input.notes,
    thumbnailUrl: parsed.thumbnailUrl,
    fileAssetId: null,
    createdBy: asObjectId(actor.userId),
  });
  await recordActivity({
    actor,
    action: ActivityAction.REFERENCE_CREATED,
    entity: { kind: ActivityEntityKind.REFERENCE, id: String(ref._id) },
    brandId: String(brand._id),
    meta: { platform: ref.platform },
  });
  return ref;
}

/** Internal users who work on the brand may add references; clients never. */
export async function createReference(
  actor: Actor,
  input: { brandId: string; url: string; title: string | null; notes: string | null },
): Promise<ReferenceDTO> {
  assertCan(canProposeIdeas(actor)); // internal users only
  const brand = await brandsRepo.getById(actor, input.brandId); // staff: own brands only
  if (brand.status !== BrandStatus.ACTIVE) throw new ConflictError("This brand is archived.");
  const ref = await withTransaction(() => createReferenceInTx(actor, brand, input));
  return toReferenceDTO(ref, actor);
}

export async function updateReference(
  actor: Actor,
  input: { referenceId: string; title: string | null; notes: string | null },
): Promise<ReferenceDTO> {
  const ref = await referencesRepo.getById(actor, input.referenceId); // clients: NONE → 404
  if (!canManageContent(actor) && String(ref.createdBy) !== actor.userId) {
    throw new ForbiddenError("Only the person who added this reference can edit it.");
  }
  return withTransaction(async () => {
    const updated = await referencesRepo.updateById(actor, input.referenceId, {
      $set: { title: input.title, notes: input.notes },
    });
    if (!updated) throw new ConflictError("This reference changed. Refresh and try again.");
    await recordActivity({
      actor,
      action: ActivityAction.REFERENCE_UPDATED,
      entity: { kind: ActivityEntityKind.REFERENCE, id: input.referenceId },
      brandId: String(ref.brandId),
      meta: { fields: ["title", "notes"] },
    });
    return toReferenceDTO(updated, actor);
  });
}

/** A brand's reference library (for pickers). */
export async function listBrandReferences(actor: Actor, brandId: string): Promise<ReferenceDTO[]> {
  assertCan(canProposeIdeas(actor));
  await brandsRepo.getById(actor, brandId);
  const refs = await referencesRepo.find(
    actor,
    { brandId: asObjectId(brandId) },
    { sort: { createdAt: -1 }, limit: 100 },
  );
  return refs.map((r) => toReferenceDTO(r, actor));
}
