import "server-only";
import { Types } from "mongoose";
import { MembershipStatus } from "@/lib/domain/brands";
import { PostingStatus } from "@/lib/domain/postings";
import { BrandRole, SystemRole, UserStatus } from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import {
  ApprovalModel,
  BrandMembershipModel,
  PostingModel,
  UserModel,
  type PostingDoc,
} from "@/server/db/models";
import { brandIdsWithRoles, brandVisibility, hasAgencyWideBrandAccess } from "./brand-visibility";
import { defineScopedRepository, NONE } from "./scoped-repository";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

/**
 * Posting records.
 *  · ADMIN / MANAGER → agency
 *  · STAFF  → only brands where they actively hold the UPLOADER role
 *             (other staff have no posting permissions or posting data)
 *  · CLIENT → their CLIENT brands, confirmed (POSTED) records only; the client
 *             serializer then strips every internal field (people, notes, proof)
 */
export const postingsRepo = defineScopedRepository<PostingDoc>({
  model: PostingModel,
  visibility: async (actor) => {
    if (hasAgencyWideBrandAccess(actor)) return {};
    if (actor.systemRole === SystemRole.CLIENT) {
      const brands = await brandVisibility<PostingDoc>(actor);
      if (brands === NONE) return NONE;
      return { $and: [brands, { status: PostingStatus.POSTED }] };
    }
    const uploaderBrands = await brandIdsWithRoles(actor, [BrandRole.UPLOADER]);
    if (uploaderBrands.length === 0) return NONE;
    return { brandId: { $in: uploaderBrands } };
  },
});

/** Insert inside the posting transaction (agencyId comes from the already-scoped content). */
export async function insertPosting(data: Omit<PostingDoc, "_id" | "createdAt" | "updatedAt">): Promise<PostingDoc> {
  await connectDb();
  const [doc] = await PostingModel.create([data]);
  return doc!.toObject();
}

/** Live (POSTING/POSTED) records for one exact version. */
export async function livePostingsForVersion(agencyId: Types.ObjectId, versionId: Types.ObjectId): Promise<PostingDoc[]> {
  await connectDb();
  return PostingModel.find({ agencyId, contentVersionId: versionId, live: true }).lean<PostingDoc[]>();
}

/** Conditional update of one posting (status precondition) — the only write path besides insert. */
export async function updatePosting(
  agencyId: Types.ObjectId,
  postingId: Types.ObjectId,
  where: Record<string, unknown>,
  update: Record<string, unknown>,
): Promise<PostingDoc | null> {
  await connectDb();
  return PostingModel.findOneAndUpdate({ _id: postingId, agencyId, ...where }, update, {
    returnDocument: "after",
    runValidators: true,
  }).lean<PostingDoc>();
}

/** Has this exact version a CLIENT APPROVED and an INTERNAL APPROVED decision? */
export async function approvalsStillHold(agencyId: Types.ObjectId, versionId: Types.ObjectId): Promise<boolean> {
  await connectDb();
  const rows = await ApprovalModel.find(
    { agencyId, contentVersionId: versionId, decision: "APPROVED" },
    { stage: 1 },
  ).lean();
  const stages = new Set(rows.map((r) => r.stage));
  return stages.has("INTERNAL") && stages.has("CLIENT");
}

export type UploaderProblem = "NO_UPLOADER" | "INACTIVE_ACCOUNT" | "NOT_AN_UPLOADER";

export interface UploaderResolution {
  /** Where the effective uploader comes from. Never falls back silently. */
  source: "OVERRIDE" | "BRAND_PRIMARY" | "NONE";
  userId: string | null;
  valid: boolean;
  problem: UploaderProblem | null;
}

/**
 * The single uploader-resolution rule:
 *   content.uploaderOverrideId, else brand.primaryUploaderId.
 * The resolved person must be an ACTIVE account of the same agency with an
 * ACTIVE UPLOADER membership on the brand. If not, the content is flagged
 * (problem) — it is NOT re-routed to anyone else automatically.
 */
export async function resolveEffectiveUploader(
  agencyId: Types.ObjectId,
  brand: { _id: Types.ObjectId; primaryUploaderId: Types.ObjectId | null },
  content: { uploaderOverrideId: Types.ObjectId | null },
): Promise<UploaderResolution> {
  const id = content.uploaderOverrideId ?? brand.primaryUploaderId;
  const source = content.uploaderOverrideId ? "OVERRIDE" : brand.primaryUploaderId ? "BRAND_PRIMARY" : "NONE";
  if (!id) return { source: "NONE", userId: null, valid: false, problem: "NO_UPLOADER" };
  await connectDb();
  const [user, membership] = await Promise.all([
    UserModel.findOne({ _id: oid(id), agencyId }, { status: 1 }).lean(),
    BrandMembershipModel.exists({
      agencyId,
      brandId: brand._id,
      userId: oid(id),
      role: BrandRole.UPLOADER,
      status: MembershipStatus.ACTIVE,
    }),
  ]);
  const userId = String(id);
  if (!user || user.status !== UserStatus.ACTIVE) return { source, userId, valid: false, problem: "INACTIVE_ACCOUNT" };
  if (!membership) return { source, userId, valid: false, problem: "NOT_AN_UPLOADER" };
  return { source, userId, valid: true, problem: null };
}
