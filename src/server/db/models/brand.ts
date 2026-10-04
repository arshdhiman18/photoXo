import "server-only";
import { defineModel } from "./define";
import { Schema, type Model, type Types } from "mongoose";
import {
  BRAND_STATUSES,
  SOCIAL_PLATFORMS,
  type BrandStatus,
  type SocialPlatform,
} from "@/lib/domain/brands";

export interface SocialHandle {
  platform: SocialPlatform;
  /** Display handle, e.g. "@mamaearth.in" (optional). */
  handle: string | null;
  url: string;
  /** Free label, used when platform = OTHER. */
  label: string | null;
}

export interface BrandDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  name: string;
  /** Normalised name for case-insensitive uniqueness within the agency. */
  nameKey: string;
  /** Stable, agency-unique slug generated at creation (not changed on rename). */
  slug: string;
  description: string | null;
  /** Stage 2: https URL. Cloudinary upload replaces this in the media stage. */
  logo: { url: string } | null;
  status: BrandStatus;
  socialHandles: SocialHandle[];
  /**
   * Default Content Uploader. Invariant (enforced by brand-team.service):
   * when set, the user holds an ACTIVE UPLOADER membership on this brand.
   * BrandMembership remains the source of truth for the UPLOADER role.
   */
  primaryUploaderId: Types.ObjectId | null;
  /** Prefix for human content codes (MAM → MAM-0142). Assigned on first content; unique per agency. */
  codePrefix: string | null;
  archivedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const socialHandleSchema = new Schema<SocialHandle>(
  {
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    handle: { type: String, default: null, maxlength: 100 },
    url: { type: String, required: true, maxlength: 500 },
    label: { type: String, default: null, maxlength: 40 },
  },
  { _id: false },
);

const brandSchema = new Schema<BrandDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    slug: { type: String, required: true },
    description: { type: String, default: null, maxlength: 1000 },
    logo: {
      type: new Schema({ url: { type: String, required: true } }, { _id: false }),
      default: null,
    },
    status: { type: String, enum: BRAND_STATUSES, required: true },
    socialHandles: { type: [socialHandleSchema], default: [] },
    primaryUploaderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    codePrefix: { type: String, default: null, maxlength: 6 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "brands" },
);

brandSchema.index({ agencyId: 1, slug: 1 }, { unique: true });
brandSchema.index({ agencyId: 1, nameKey: 1 }, { unique: true });
brandSchema.index({ agencyId: 1, status: 1, name: 1 });
brandSchema.index(
  { agencyId: 1, codePrefix: 1 },
  { unique: true, partialFilterExpression: { codePrefix: { $type: "string" } } },
);

export const BrandModel: Model<BrandDoc> = defineModel<BrandDoc>("Brand", brandSchema);
