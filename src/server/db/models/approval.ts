import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import {
  APPROVAL_DECISIONS,
  APPROVAL_SOURCES,
  APPROVAL_STAGES,
  APPROVAL_COMMENT_MAX,
  type ApprovalDecision,
  type ApprovalSource,
  type ApprovalStage,
  type CommentVisibility,
} from "@/lib/domain/approvals";
import { defineModel } from "./define";

/**
 * One approval DECISION on one exact content version at one gate.
 * Append-only: records are never updated, replaced or deleted (enforced by
 * schema hooks below). V2 is never "an update" of V1 — each version collects
 * its own decisions.
 */
export interface ApprovalDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  contentId: Types.ObjectId;
  contentVersionId: Types.ObjectId;
  /** Denormalised for display; the id above is authoritative. */
  versionNumber: number;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  comment: string | null;
  /** Fixed at write time from stage + source (see commentVisibilityFor). */
  commentVisibility: CommentVisibility;
  /** Who actually decided — distinguishes a client's own click from an admin recording it. */
  source: ApprovalSource;
  /** The authenticated user who performed the action (for RECORDED_BY_ADMIN: the admin). */
  decidedBy: Types.ObjectId;
  decidedAt: Date;
  createdAt: Date;
}

const approvalSchema = new Schema<ApprovalDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", required: true },
    contentVersionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", required: true },
    versionNumber: { type: Number, required: true, min: 1 },
    stage: { type: String, enum: APPROVAL_STAGES, required: true },
    decision: { type: String, enum: APPROVAL_DECISIONS, required: true },
    comment: { type: String, default: null, maxlength: APPROVAL_COMMENT_MAX },
    commentVisibility: { type: String, enum: ["INTERNAL", "CLIENT"], required: true },
    source: { type: String, enum: APPROVAL_SOURCES, required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    decidedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "approvals" },
);

// History of one content item (timeline, client history).
approvalSchema.index({ agencyId: 1, contentId: 1, decidedAt: -1 });
// Decisions on one exact version ("was this version internally approved?", "already decided?").
approvalSchema.index({ agencyId: 1, contentVersionId: 1, stage: 1 });
// Brand approvals tab.
approvalSchema.index({ agencyId: 1, brandId: 1, decidedAt: -1 });
// Recent decisions feed filtered by gate / decision.
approvalSchema.index({ agencyId: 1, stage: 1, decision: 1, decidedAt: -1 });

// Append-only at the data layer: any update/replace/delete is refused.
const refuse = function () {
  throw new Error("Approval records are append-only");
};
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  approvalSchema.pre(op, refuse);
}
approvalSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Approval records are append-only");
});

export const ApprovalModel: Model<ApprovalDoc> = defineModel<ApprovalDoc>("Approval", approvalSchema);
