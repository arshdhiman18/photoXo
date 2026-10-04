import "server-only";
import { defineModel } from "./define";
import { Schema, type Model, type Types } from "mongoose";
import { MEMBERSHIP_STATUSES, type MembershipStatus } from "@/lib/domain/brands";
import { BrandRole, type BrandRole as BrandRoleT } from "@/lib/domain/roles";

/**
 * One row per (agency, brand, user, BRAND ROLE). A person with two roles on a
 * brand has two rows; many people may share a role. Rows are never deleted —
 * removal sets status INACTIVE so history (and future content references)
 * stays intact. Re-adding reactivates the same row.
 */
export interface BrandMembershipDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  userId: Types.ObjectId;
  role: BrandRoleT;
  status: MembershipStatus;
  addedBy: Types.ObjectId;
  activatedAt: Date;
  deactivatedAt: Date | null;
  deactivatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<BrandMembershipDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: Object.values(BrandRole), required: true },
    status: { type: String, enum: MEMBERSHIP_STATUSES, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    activatedAt: { type: Date, required: true },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "brandMemberships" },
);

// No duplicate assignment of the same role to the same person on a brand.
membershipSchema.index({ agencyId: 1, brandId: 1, userId: 1, role: 1 }, { unique: true });
// "Which brands can this user see?" (visibility resolver, hot path)
membershipSchema.index({ agencyId: 1, userId: 1, status: 1, role: 1 });
// "Who is on this brand?" (team views, uploader routing)
membershipSchema.index({ agencyId: 1, brandId: 1, status: 1, role: 1 });

export const BrandMembershipModel: Model<BrandMembershipDoc> = defineModel<BrandMembershipDoc>(
  "BrandMembership",
  membershipSchema,
);
