import "server-only";
import { defineModel } from "./define";
import { Schema, type Model, type Types } from "mongoose";

/**
 * Single-use account-setup invitation. Only the SHA-256 hash of the token is
 * stored; the raw token exists only in the emailed link.
 */
export interface InvitationDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  userId: Types.ObjectId;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: Types.ObjectId | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSchema = new Schema<InvitationDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "invitations" },
);

invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ agencyId: 1, userId: 1, createdAt: -1 });

export const InvitationModel: Model<InvitationDoc> = defineModel<InvitationDoc>(
  "Invitation",
  invitationSchema,
);
