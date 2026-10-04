import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import {
  MAX_POSTING_NOTE,
  POSTING_PLATFORMS,
  POSTING_SOURCES,
  POSTING_STATUSES,
  type PostingPlatform,
  type PostingSource,
  type PostingStatus,
} from "@/lib/domain/postings";
import { defineModel } from "./define";

/** One controlled correction of a POSTED record — the previous values are kept forever. */
export interface PostingCorrection {
  previous: { postUrl: string | null; postedAt: Date | null; screenshotAssetId: Types.ObjectId | null };
  reason: string;
  correctedBy: Types.ObjectId;
  correctedAt: Date;
}

/**
 * One platform posting of one exact (client-approved) content version.
 * Historical operational record: never deleted. Changes happen only through
 * the posting service (start → confirm, controlled correction, cancellation
 * when content goes back for changes before anything was posted), each
 * audited in the same transaction.
 */
export interface PostingDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  contentId: Types.ObjectId;
  /** Always the content's clientApprovedVersionId at the time of posting. */
  contentVersionId: Types.ObjectId;
  versionNumber: number;
  platform: PostingPlatform;
  status: PostingStatus;
  /** At most one live (POSTING/POSTED) record per version + platform; false once CANCELLED. */
  live: boolean;
  postUrl: string | null;
  postedAt: Date | null;
  /** Optional proof (an Asset — external link today, uploaded media later). */
  screenshotAssetId: Types.ObjectId | null;
  note: string | null;
  /** The uploader credited with the post (the effective uploader). null only if none was valid. */
  postedBy: Types.ObjectId | null;
  /** Who actually recorded it (= postedBy for UPLOADER; the ADMIN for RECORDED_BY_ADMIN). */
  recordedBy: Types.ObjectId | null;
  source: PostingSource | null;
  /** Mandatory when an ADMIN records on the uploader's behalf. */
  adminReason: string | null;
  startedBy: Types.ObjectId;
  startedAt: Date;
  confirmedAt: Date | null;
  corrections: PostingCorrection[];
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const correctionSchema = new Schema<PostingCorrection>(
  {
    previous: {
      postUrl: { type: String, default: null },
      postedAt: { type: Date, default: null },
      screenshotAssetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    },
    reason: { type: String, required: true, maxlength: 500 },
    correctedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    correctedAt: { type: Date, required: true },
  },
  { _id: false },
);

const postingSchema = new Schema<PostingDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", required: true },
    contentVersionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", required: true },
    versionNumber: { type: Number, required: true, min: 1 },
    platform: { type: String, enum: POSTING_PLATFORMS, required: true },
    status: { type: String, enum: POSTING_STATUSES, required: true },
    live: { type: Boolean, required: true },
    postUrl: { type: String, default: null, maxlength: 1000 },
    postedAt: { type: Date, default: null },
    screenshotAssetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    note: { type: String, default: null, maxlength: MAX_POSTING_NOTE },
    postedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    source: { type: String, enum: [...POSTING_SOURCES, null], default: null },
    adminReason: { type: String, default: null, maxlength: 500 },
    startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startedAt: { type: Date, required: true },
    confirmedAt: { type: Date, default: null },
    corrections: { type: [correctionSchema], default: [] },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true, collection: "postings" },
);

// One live posting per approved version + platform (races → duplicate key → transaction aborts).
postingSchema.index(
  { agencyId: 1, contentVersionId: 1, platform: 1 },
  { unique: true, partialFilterExpression: { live: true } },
);
// Posting records of a content item (detail page, completion check).
postingSchema.index({ agencyId: 1, contentId: 1, createdAt: 1 });
// Uploader's own posting history / in-progress items.
postingSchema.index({ agencyId: 1, postedBy: 1, status: 1, postedAt: -1 });
// Brand posting history.
postingSchema.index({ agencyId: 1, brandId: 1, postedAt: -1 });
// Agency posting history filtered by platform/status.
postingSchema.index({ agencyId: 1, platform: 1, status: 1, postedAt: -1 });

// Never deleted in normal operation.
const refuse = function () {
  throw new Error("Posting records are never deleted");
};
for (const op of ["deleteOne", "deleteMany", "findOneAndDelete"] as const) postingSchema.pre(op, refuse);

export const PostingModel: Model<PostingDoc> = defineModel<PostingDoc>("Posting", postingSchema);
