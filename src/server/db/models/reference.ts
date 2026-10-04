import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { REFERENCE_PLATFORMS, type ReferencePlatform } from "@/lib/domain/references";
import { defineModel } from "./define";

/**
 * Brand-level reference library entry. Social media is never downloaded —
 * only the URL/id is stored and rendered through official embeds or a link.
 */
export interface ReferenceDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  platform: ReferencePlatform;
  url: string | null;
  externalId: string | null;
  /** Instagram post kind (p | reel | tv). */
  variant: string | null;
  title: string | null;
  notes: string | null;
  thumbnailUrl: string | null;
  /** When platform = FILE: the uploaded asset (media stage). */
  fileAssetId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const referenceSchema = new Schema<ReferenceDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    platform: { type: String, enum: REFERENCE_PLATFORMS, required: true },
    url: { type: String, default: null, maxlength: 1000 },
    externalId: { type: String, default: null, maxlength: 100 },
    variant: { type: String, default: null, maxlength: 10 },
    title: { type: String, default: null, maxlength: 160 },
    notes: { type: String, default: null, maxlength: 1000 },
    thumbnailUrl: { type: String, default: null, maxlength: 1000 },
    fileAssetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "references" },
);

referenceSchema.index({ agencyId: 1, brandId: 1, createdAt: -1 });

export const ReferenceModel: Model<ReferenceDoc> = defineModel<ReferenceDoc>(
  "Reference",
  referenceSchema,
);
