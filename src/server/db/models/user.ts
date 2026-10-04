import "server-only";
import { defineModel } from "./define";
import { Schema, type Model, type Types } from "mongoose";
import { SYSTEM_ROLES, USER_STATUSES, type SystemRole, type UserStatus } from "@/lib/domain/roles";

/**
 * Application user. Shares the `users` collection with Better Auth, which
 * owns the authentication fields (name, email, emailVerified, image,
 * timestamps) and stores credentials separately in `accounts`.
 *
 * Authorization fields (role, status, agencyId) are NOT registered with
 * Better Auth, so no auth endpoint (e.g. /update-user) can ever write them.
 * They are changed exclusively through our services.
 */
export interface UserDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role: SystemRole;
  status: UserStatus;
  invitedBy?: Types.ObjectId | null;
  invitedAt?: Date | null;
  activatedAt?: Date | null;
  suspendedAt?: Date | null;
  deactivatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    emailVerified: { type: Boolean, required: true, default: false },
    image: { type: String, default: null },
    role: { type: String, enum: SYSTEM_ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    invitedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "users" },
);

// Email is globally unique (one identity per person across the platform).
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ agencyId: 1, role: 1, status: 1 });
userSchema.index({ agencyId: 1, createdAt: -1 });

export const UserModel: Model<UserDoc> = defineModel<UserDoc>("User", userSchema);
