import "server-only";
import { defineModel } from "./define";
import { Schema, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Tenant root. V1 runs a single agency, but every tenant-scoped document
 * carries `agencyId` so the product can become multi-tenant SaaS without a
 * data migration.
 */
const agencySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    timezone: { type: String, required: true },
    currency: { type: String, required: true, minlength: 3, maxlength: 3 },
  },
  { timestamps: true, collection: "agencies" },
);

export type AgencyDoc = InferSchemaType<typeof agencySchema> & { _id: Types.ObjectId };

export const AgencyModel: Model<AgencyDoc> = defineModel<AgencyDoc>("Agency", agencySchema);
