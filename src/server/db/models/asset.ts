import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { EXTERNAL_ASSET_PROVIDERS, type ExternalAssetProvider } from "@/lib/domain/content";
import { defineModel } from "./define";

/**
 * A file or link attached to something (content version, reference, later
 * receipts/screenshots). Stage 6 posting proof is a POSTING_PROOF link;
 * Stage 8 adds RECEIPT and uploaded MEDIA (Cloudinary) with owner scope. Stage 3 creates EXTERNAL_LINK assets (Canva, Figma,
 * Drive…). The MEDIA shape is defined now so the Cloudinary stage only fills it.
 */
export interface MediaInfo {
  provider: "CLOUDINARY";
  publicId: string;
  resourceType: "image" | "video" | "raw";
  /** File extension Cloudinary stored (jpg, png, webp, mp4, mov, pdf…). */
  format: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  /** Derived renditions (never the original) for dashboards. */
  previewUrl: string | null;
  thumbnailUrl: string | null;
  processing: "PENDING" | "READY" | "FAILED";
  /** Set when retention removed the bytes; metadata stays. */
  purgedAt: Date | null;
}

export type AssetKind = "CREATION" | "RAW" | "REFERENCE_FILE" | "POSTING_PROOF" | "RECEIPT" | "LOGO";
export const ASSET_KINDS: AssetKind[] = ["CREATION", "RAW", "REFERENCE_FILE", "POSTING_PROOF", "RECEIPT", "LOGO"];

export interface AssetDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  /** Owning brand. null only for receipts of expenses not linked to a brand. */
  brandId: Types.ObjectId | null;
  kind: AssetKind;
  storage: "EXTERNAL_LINK" | "MEDIA";
  external: { url: string; provider: ExternalAssetProvider; label: string | null } | null;
  media: MediaInfo | null;
  originalFilename: string | null;
  /**
   * What the asset belongs to (scope for access checks and retention).
   * Set once when the asset is attached; never moved between owners.
   */
  contentId?: Types.ObjectId | null;
  versionId?: Types.ObjectId | null;
  expenseId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const assetSchema = new Schema<AssetDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
      required: function (this: { kind?: string }) {
        return this.kind !== "RECEIPT" && this.kind !== "LOGO"; // receipts / logos (new brands) have no brand
      },
    },
    kind: { type: String, enum: ASSET_KINDS, required: true },
    storage: { type: String, enum: ["EXTERNAL_LINK", "MEDIA"], required: true },
    external: {
      type: new Schema(
        {
          url: { type: String, required: true, maxlength: 1000 },
          provider: { type: String, enum: EXTERNAL_ASSET_PROVIDERS, required: true },
          label: { type: String, default: null, maxlength: 120 },
        },
        { _id: false },
      ),
      default: null,
    },
    media: { type: Schema.Types.Mixed, default: null },
    originalFilename: { type: String, default: null, maxlength: 255 },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", default: null },
    versionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", default: null },
    expenseId: { type: Schema.Types.ObjectId, ref: "Expense", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "assets" },
);

assetSchema.index({ agencyId: 1, brandId: 1, createdAt: -1 });
// Media retention scan (uploaded media only).
assetSchema.index({ agencyId: 1, storage: 1, createdAt: 1 }, { partialFilterExpression: { storage: "MEDIA" } });

export const AssetModel: Model<AssetDoc> = defineModel<AssetDoc>("Asset", assetSchema);
