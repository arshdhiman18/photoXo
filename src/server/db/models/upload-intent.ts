import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { defineModel } from "./define";

export type UploadPurpose = "VERSION_MEDIA" | "RECEIPT" | "BRAND_LOGO";

/**
 * A server-issued permission to upload ONE file to ONE server-chosen
 * Cloudinary public id. Finalising verifies the stored resource against this
 * record — the browser never names the public id or the owner. Unused
 * intents expire (TTL removes them a day after expiry; they hold no
 * business data). Consumed intents keep the link to the created asset.
 */
export interface UploadIntentDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: UploadPurpose;
  brandId: Types.ObjectId | null;
  contentId: Types.ObjectId | null;
  publicId: string;
  resourceType: "image" | "video" | "raw";
  filename: string;
  mimeType: string;
  bytes: number;
  expiresAt: Date;
  consumedAt: Date | null;
  assetId: Types.ObjectId | null;
  createdAt: Date;
}

const schema = new Schema<UploadIntentDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: ["VERSION_MEDIA", "RECEIPT", "BRAND_LOGO"], required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", default: null },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", default: null },
    publicId: { type: String, required: true, maxlength: 200 },
    resourceType: { type: String, enum: ["image", "video", "raw"], required: true },
    filename: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 100 },
    bytes: { type: Number, required: true, min: 1 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    assetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "uploadIntents" },
);

schema.index({ agencyId: 1, userId: 1, createdAt: -1 });
schema.index({ publicId: 1 }, { unique: true });
// Unused intents disappear a day after they expire (never consumed ones only).
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400, partialFilterExpression: { consumedAt: null } });

export const UploadIntentModel: Model<UploadIntentDoc> = defineModel<UploadIntentDoc>("UploadIntent", schema);
