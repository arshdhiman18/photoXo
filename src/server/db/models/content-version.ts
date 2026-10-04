import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { defineModel } from "./define";

/**
 * An immutable submission of a content item (V1, V2, V3…). Future manager and
 * client approvals reference the exact version they approved, so versions are
 * never updated or deleted — a correction is always a new version.
 */
export interface ContentVersionDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  contentId: Types.ObjectId;
  versionNumber: number;
  /** Ordered (carousel order). */
  assetIds: Types.ObjectId[];
  caption: string | null;
  hashtags: string[];
  /** "What changed since the previous version". */
  changeNote: string | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const versionSchema = new Schema<ContentVersionDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", required: true },
    versionNumber: { type: Number, required: true, min: 1 },
    assetIds: { type: [Schema.Types.ObjectId], ref: "Asset", default: [] },
    caption: { type: String, default: null, maxlength: 2200 },
    hashtags: { type: [String], default: [] },
    changeNote: { type: String, default: null, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "contentVersions" },
);

versionSchema.index({ agencyId: 1, contentId: 1, versionNumber: 1 }, { unique: true });

// Immutability at the data layer: any update/replace/delete is refused.
const refuse = function () {
  throw new Error("Content versions are immutable");
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
  versionSchema.pre(op, refuse);
}
versionSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Content versions are immutable");
});

export const ContentVersionModel: Model<ContentVersionDoc> = defineModel<ContentVersionDoc>(
  "ContentVersion",
  versionSchema,
);
