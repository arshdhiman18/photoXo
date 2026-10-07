import "server-only";
import { randomBytes } from "node:crypto";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { PRODUCTION_STATUSES } from "@/lib/domain/content";
import { incomingTransformation, LOGO_MAX_BYTES, LOGO_MIME_TYPES, RECEIPT_MIME_TYPES, UPLOAD_INTENT_TTL_MS, UPLOAD_TYPES, type UploadMimeType } from "@/lib/domain/media";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { assertCan, canManageBrands, canSubmitExpenses } from "@/server/authz/permissions";
import type { UploadPurpose } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { fetchResource, isCloudinaryConfigured, signedDeliveryUrl, signedUploadParams } from "@/server/media/cloudinary";
import { assetViewUrl } from "@/server/media/urls";
import { consumeIntent, findOwnOpenIntent, insertMediaAsset, insertUploadIntent } from "@/server/repositories/media.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { getVisibleContent } from "./content.service";
import { assertMayAddVersion } from "./versions.service";

/*
 * Uploads (Stage 8). Three steps, all authorised server-side:
 *   1. createUploadIntent — check the actor may add media for this purpose,
 *      choose the Cloudinary public id, sign the upload parameters.
 *   2. The browser sends the file straight to Cloudinary (never through us,
 *      never processed in the browser).
 *   3. finalizeUpload — look up OUR public id via the Admin API, verify type
 *      and size, record the Asset (metadata lives in our DB), consume the
 *      intent (single use), audit.
 * The browser never supplies a public id, owner, brand or URL.
 */

export function mediaEnabled() {
  return isCloudinaryConfigured();
}

export async function createUploadIntent(
  actor: Actor,
  input: { purpose: UploadPurpose; contentId: string | null; filename: string; mimeType: string; bytes: number },
) {
  if (!isCloudinaryConfigured()) throw new ConflictError("Uploads aren't set up for this workspace — add a link instead.");
  const type = UPLOAD_TYPES[input.mimeType as UploadMimeType];
  if (!type) throw new ValidationError("This file type isn't supported.", { file: ["Use JPEG, PNG, WebP, PDF, MP4, MOV or WebM"] });
  if (input.purpose === "RECEIPT" && !RECEIPT_MIME_TYPES.includes(input.mimeType as UploadMimeType)) {
    throw new ValidationError("Receipts must be an image or PDF.", { file: ["Use JPEG, PNG, WebP or PDF"] });
  }
  if (input.purpose === "BRAND_LOGO" && (!LOGO_MIME_TYPES.includes(input.mimeType as UploadMimeType) || input.bytes > LOGO_MAX_BYTES)) {
    throw new ValidationError("Logos must be a JPEG, PNG or WebP image up to 5 MB.", { file: ["Use a JPEG, PNG or WebP image up to 5 MB"] });
  }
  if (input.bytes > type.maxBytes) {
    throw new ValidationError("This file is too large.", { file: [`Max ${Math.round(type.maxBytes / 1024 / 1024)} MB`] });
  }

  let brandId = null;
  let contentId = null;
  if (input.purpose === "VERSION_MEDIA") {
    if (!input.contentId) throw new ValidationError("Missing content.", { contentId: ["Required"] });
    const content = await getVisibleContent(actor, input.contentId); // scope → 404
    if (content.archivedAt || !PRODUCTION_STATUSES.includes(content.status)) {
      throw new ConflictError("Media can only be added while the content is in production.");
    }
    await assertMayAddVersion(actor, content);
    brandId = content.brandId;
    contentId = content._id;
  } else if (input.purpose === "BRAND_LOGO") {
    assertCan(canManageBrands(actor));
  } else {
    assertCan(canSubmitExpenses(actor));
  }

  const folder = input.purpose === "RECEIPT" ? "receipts" : input.purpose === "BRAND_LOGO" ? "logos" : String(brandId);
  const publicId = `photoxo/${actor.agencyId}/${folder}/${randomBytes(12).toString("hex")}`;
  const intent = await insertUploadIntent({
    agencyId: asObjectId(actor.agencyId),
    userId: asObjectId(actor.userId),
    purpose: input.purpose,
    brandId,
    contentId,
    publicId,
    resourceType: type.resourceType,
    filename: input.filename.slice(0, 255),
    mimeType: input.mimeType,
    bytes: input.bytes,
    expiresAt: new Date(Date.now() + UPLOAD_INTENT_TTL_MS),
    consumedAt: null,
    assetId: null,
  });
  const signed = signedUploadParams({ publicId, resourceType: type.resourceType, ...incomingTransformation(input.purpose, input.mimeType) });
  return { intentId: String(intent._id), uploadUrl: signed.uploadUrl, fields: signed.fields };
}

export async function finalizeUpload(actor: Actor, intentId: string) {
  const now = new Date();
  const intent = await findOwnOpenIntent(actor.agencyId, actor.userId, intentId, now);
  if (!intent) throw new NotFoundError();
  const type = UPLOAD_TYPES[intent.mimeType as UploadMimeType];
  const resource = await fetchResource(intent.publicId, intent.resourceType);
  if (!resource) throw new ConflictError("The upload didn't arrive. Please try again.");
  if (resource.type !== "authenticated" || resource.public_id !== intent.publicId) {
    throw new ConflictError("The uploaded file doesn't match this upload.");
  }
  if (!(type.formats as readonly string[]).includes(resource.format) || resource.bytes > type.maxBytes) {
    throw new ValidationError("The uploaded file isn't an accepted type or is too large.", { file: ["Upload a supported file"] });
  }
  return withTransaction(async () => {
    const asset = await insertMediaAsset({
      agencyId: intent.agencyId,
      brandId: intent.brandId,
      kind: intent.purpose === "RECEIPT" ? "RECEIPT" : intent.purpose === "BRAND_LOGO" ? "LOGO" : "CREATION",
      storage: "MEDIA",
      external: null,
      media: {
        provider: "CLOUDINARY",
        publicId: resource.public_id,
        resourceType: resource.resource_type,
        format: resource.format,
        mimeType: intent.mimeType,
        bytes: resource.bytes,
        width: resource.width ?? null,
        height: resource.height ?? null,
        durationSec: resource.duration ?? null,
        previewUrl: null, // derived on demand as signed URLs (never stored public)
        thumbnailUrl: null,
        processing: "READY",
        purgedAt: null,
      },
      originalFilename: intent.filename,
      contentId: intent.contentId,
      versionId: null,
      expenseId: null,
      createdBy: asObjectId(actor.userId),
    });
    if (!(await consumeIntent(intent._id, asset._id, now))) throw new ConflictError("This upload was already completed.");
    await recordActivity({
      actor,
      action: ActivityAction.MEDIA_UPLOADED,
      entity: { kind: ActivityEntityKind.ASSET, id: String(asset._id) },
      brandId: intent.brandId ? String(intent.brandId) : null,
      meta: { purpose: intent.purpose, contentId: intent.contentId ? String(intent.contentId) : null, bytes: resource.bytes, format: resource.format },
    });
    // Logos are shown everywhere a brand appears, so the brand stores a stable signed URL.
    const logoUrl =
      intent.purpose === "BRAND_LOGO"
        ? signedDeliveryUrl({ publicId: resource.public_id, resourceType: "image", format: resource.format, transformation: "c_limit,w_256,h_256,q_auto" })
        : null;
    return { assetId: String(asset._id), filename: intent.filename, previewUrl: assetViewUrl(asset), logoUrl, bytes: resource.bytes };
  });
}
