import "server-only";
import { Types } from "mongoose";
import { connectDb } from "@/server/db/connect";
import { AssetModel, ContentModel, UploadIntentModel, type AssetDoc, type UploadIntentDoc } from "@/server/db/models";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

export async function insertUploadIntent(data: Omit<UploadIntentDoc, "_id" | "createdAt">): Promise<UploadIntentDoc> {
  await connectDb();
  const [doc] = await UploadIntentModel.create([data]);
  return doc!.toObject();
}

/** The actor's own, unexpired, unconsumed intent — anything else is not found. */
export async function findOwnOpenIntent(agencyId: string, userId: string, intentId: string, now: Date): Promise<UploadIntentDoc | null> {
  if (!Types.ObjectId.isValid(intentId)) return null;
  await connectDb();
  return UploadIntentModel.findOne({
    _id: oid(intentId),
    agencyId: oid(agencyId),
    userId: oid(userId),
    consumedAt: null,
    expiresAt: { $gt: now },
  }).lean<UploadIntentDoc>();
}

/** Single-use: only one finalisation can consume an intent (inside the transaction). */
export async function consumeIntent(intentId: Types.ObjectId, assetId: Types.ObjectId, now: Date): Promise<boolean> {
  await connectDb();
  const r = await UploadIntentModel.updateOne({ _id: intentId, consumedAt: null }, { $set: { consumedAt: now, assetId } });
  return r.modifiedCount === 1;
}

export async function insertMediaAsset(data: Omit<AssetDoc, "_id" | "createdAt" | "updatedAt">): Promise<AssetDoc> {
  await connectDb();
  const [doc] = await AssetModel.create([data]);
  return doc!.toObject();
}

/**
 * Uploaded creation media the actor may attach to a NEW version of this
 * content: same agency + brand + content, uploaded by the actor, not yet in
 * any version. Returns only matching assets (callers compare counts).
 */
export async function attachableCreationMedia(
  content: { _id: Types.ObjectId; agencyId: Types.ObjectId; brandId: Types.ObjectId },
  userId: string,
  ids: string[],
): Promise<AssetDoc[]> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id)).map(oid);
  if (valid.length === 0) return [];
  await connectDb();
  return AssetModel.find({
    _id: { $in: valid },
    agencyId: content.agencyId,
    brandId: content.brandId,
    contentId: content._id,
    kind: "CREATION",
    storage: "MEDIA",
    versionId: null,
    createdBy: oid(userId),
  }).lean<AssetDoc[]>();
}

export async function attachMediaToVersion(assetIds: Types.ObjectId[], versionId: Types.ObjectId): Promise<number> {
  if (assetIds.length === 0) return 0;
  await connectDb();
  const r = await AssetModel.updateMany({ _id: { $in: assetIds }, versionId: null }, { $set: { versionId } });
  return r.modifiedCount;
}

/**
 * Retention PLANNING (dry run — nothing is deleted automatically).
 * Candidates: uploaded CREATION media whose content is archived and older
 * than `olderThanDays`, that is NOT part of the content's current version.
 * Receipts are never candidates (financial records), nor anything of
 * active (non-archived) content. Metadata always stays.
 */
export async function mediaRetentionCandidates(agencyId: Types.ObjectId, now: Date, olderThanDays: number): Promise<AssetDoc[]> {
  await connectDb();
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
  const archived = await ContentModel.find({ agencyId, archivedAt: { $ne: null, $lt: cutoff } }, { currentVersionId: 1 }).lean();
  if (archived.length === 0) return [];
  const current = archived.flatMap((c) => (c.currentVersionId ? [c.currentVersionId] : []));
  return AssetModel.find({
    agencyId,
    storage: "MEDIA",
    kind: "CREATION",
    contentId: { $in: archived.map((c) => c._id) },
    versionId: { $nin: current },
    "media.purgedAt": null,
  })
    .limit(500)
    .lean<AssetDoc[]>();
}
