import "server-only";
import type { z } from "zod";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { detectAssetProvider, PRODUCTION_STATUSES, VERSION_TASK_TYPES } from "@/lib/domain/content";
import type { createVersionSchema } from "@/features/content/schemas";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import type { ContentDoc } from "@/server/db/models";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/authz/errors";
import { canManageContent } from "@/server/authz/permissions";
import { withTransaction } from "@/server/db/transaction";
import {
  contentRepo,
  insertAssets,
  insertVersion,
  reserveVersionNumber,
  tasksRepo,
} from "@/server/repositories/content.repo";
import { attachMediaToVersion, attachableCreationMedia } from "@/server/repositories/media.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { getVisibleContent } from "./content.service";
import { markInProductionIfPlanned } from "./tasks.service";

type CreateVersion = z.output<typeof createVersionSchema>;

/**
 * Who may add a version (or upload media for one): managers, or the
 * assignee of a non-cancelled version-producing task on this content.
 */
export async function assertMayAddVersion(actor: Actor, content: Pick<ContentDoc, "_id">) {
  if (canManageContent(actor)) return;
  const mine = await tasksRepo.count(actor, {
    contentId: content._id,
    assignedTo: asObjectId(actor.userId),
    status: { $ne: "CANCELLED" },
    taskType: { $in: VERSION_TASK_TYPES },
  });
  if (mine === 0) throw new ForbiddenError("Only the assigned creator or a manager can add a version.");
}

/**
 * Submit a new, immutable version: external links (Canva, Figma, Drive,
 * Frame.io…) and/or media uploaded through the Cloudinary pipeline (Stage 8).
 * Creating a version does not submit it for review (that is an explicit step).
 *
 * Who: managers, or the assignee of a non-cancelled version-producing task
 * on this content.
 */
export async function createVersion(
  actor: Actor,
  input: CreateVersion,
): Promise<{ id: string; versionNumber: number }> {
  const content = await getVisibleContent(actor, input.contentId); // scope → 404 (other agency/brand)
  if (content.archivedAt || !PRODUCTION_STATUSES.includes(content.status)) {
    throw new ConflictError("Versions can only be added while the content is in production.");
  }
  await assertMayAddVersion(actor, content);
  // Direct (non-action) callers may omit the optional lists.
  const assetIds = input.assetIds ?? [];
  const links = input.links ?? [];
  if (assetIds.length + links.length === 0) {
    throw new ValidationError("Add at least one link or upload.", { links: ["Add at least one link or upload"] });
  }
  // Uploaded media must be this actor's, for THIS content, not yet in a version.
  const media = assetIds.length ? await attachableCreationMedia(content, actor.userId, assetIds) : [];
  if (media.length !== new Set(assetIds).size) {
    throw new ValidationError("Some uploads can't be used for this version.", { assetIds: ["Upload the files again"] });
  }

  return withTransaction(async () => {
    const versionNumber = await reserveVersionNumber(actor.agencyId, input.contentId);
    const assets = await insertAssets(
      links.map((l) => ({
        agencyId: content.agencyId,
        brandId: content.brandId,
        kind: "CREATION" as const,
        storage: "EXTERNAL_LINK" as const,
        external: { url: l.url, provider: detectAssetProvider(l.url), label: l.label },
        media: null,
        originalFilename: null,
        contentId: content._id,
        versionId: null,
        expenseId: null,
        createdBy: asObjectId(actor.userId),
      })),
    );
    const ordered = assetIds.map((id) => media.find((m) => String(m._id) === id)!._id);
    const version = await insertVersion({
      agencyId: content.agencyId,
      brandId: content.brandId,
      contentId: content._id,
      versionNumber,
      assetIds: [...ordered, ...assets.map((a) => a._id)],
      caption: input.caption,
      hashtags: input.hashtags,
      changeNote: input.changeNote,
      createdBy: asObjectId(actor.userId),
    });
    await attachMediaToVersion(assets.map((a) => a._id), version._id);
    if ((await attachMediaToVersion(ordered, version._id)) !== ordered.length) {
      throw new ConflictError("An upload was just used elsewhere. Try again.");
    }
    const updated = await contentRepo.updateById(actor, input.contentId, {
      $set: { currentVersionId: version._id },
    });
    if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
    await recordActivity({
      actor,
      action: ActivityAction.VERSION_CREATED,
      entity: { kind: ActivityEntityKind.CONTENT_VERSION, id: String(version._id) },
      brandId: String(content.brandId),
      meta: { contentId: input.contentId, versionNumber, assets: assets.length + ordered.length, uploads: ordered.length },
    });
    await markInProductionIfPlanned(actor, content, "version_added");
    return { id: String(version._id), versionNumber };
  });
}
