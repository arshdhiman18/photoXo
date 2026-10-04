import "server-only";
import { Types } from "mongoose";
import { ApprovalDecision, ApprovalStage } from "@/lib/domain/approvals";
import { SystemRole } from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import {
  ApprovalModel,
  ContentVersionModel,
  type ApprovalDoc,
  type ContentVersionDoc,
} from "@/server/db/models";
import { brandVisibility } from "./brand-visibility";
import { defineScopedRepository, NONE } from "./scoped-repository";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

/**
 * Approval records (append-only).
 *  · ADMIN / MANAGER → agency
 *  · STAFF  → their brands (internal users see the internal history)
 *  · CLIENT → their CLIENT brands, CLIENT-gate decisions only. Internal-gate
 *             records never match a client query. Comment visibility is
 *             applied again by the client serializer.
 */
export const approvalsRepo = defineScopedRepository<ApprovalDoc>({
  model: ApprovalModel,
  visibility: async (actor) => {
    const brands = await brandVisibility<ApprovalDoc>(actor);
    if (brands === NONE) return NONE;
    if (actor.systemRole === SystemRole.CLIENT) {
      return { $and: [brands, { stage: ApprovalStage.CLIENT }] };
    }
    return brands;
  },
});

/** Append one decision. Call inside the transaction that moves the content. */
export async function insertApproval(data: Omit<ApprovalDoc, "_id" | "createdAt">): Promise<ApprovalDoc> {
  await connectDb();
  const [doc] = await ApprovalModel.create([data]);
  return doc!.toObject();
}

/**
 * The version, only if it belongs to THIS content of THIS agency and brand.
 * Callers must have loaded the content through a scoped repository first;
 * a version id from another content/brand/agency simply matches nothing.
 */
export async function versionOfContent(
  content: { _id: Types.ObjectId; agencyId: Types.ObjectId; brandId: Types.ObjectId },
  versionId: string | Types.ObjectId,
): Promise<ContentVersionDoc | null> {
  if (typeof versionId === "string" && !Types.ObjectId.isValid(versionId)) return null;
  await connectDb();
  return ContentVersionModel.findOne({
    _id: oid(versionId),
    agencyId: content.agencyId,
    brandId: content.brandId,
    contentId: content._id,
  }).lean<ContentVersionDoc>();
}

/** Has this exact version already received a decision (optionally at one gate)? */
export async function versionDecisionCount(
  agencyId: Types.ObjectId,
  versionId: Types.ObjectId,
  stage?: ApprovalStage,
): Promise<number> {
  await connectDb();
  return ApprovalModel.countDocuments({
    agencyId,
    contentVersionId: versionId,
    ...(stage ? { stage } : {}),
  });
}

/** Did this exact version pass the INTERNAL gate? (Clients only ever see such versions.) */
export async function isInternallyApproved(
  agencyId: Types.ObjectId,
  versionId: Types.ObjectId,
): Promise<boolean> {
  await connectDb();
  const n = await ApprovalModel.countDocuments({
    agencyId,
    contentVersionId: versionId,
    stage: ApprovalStage.INTERNAL,
    decision: ApprovalDecision.APPROVED,
  });
  return n > 0;
}
