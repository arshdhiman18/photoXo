import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { defineModel } from "./define";

/**
 * Minimal per-user notification preferences. Missing document = defaults
 * (both on). Critical operational notifications are created in-app even when
 * `inAppEnabled` is off; email is only ever sent when `emailEnabled` is on.
 */
export interface NotificationPreferenceDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  userId: Types.ObjectId;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<NotificationPreferenceDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    inAppEnabled: { type: Boolean, required: true, default: true },
    emailEnabled: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, collection: "notificationPreferences" },
);

schema.index({ agencyId: 1, userId: 1 }, { unique: true });

export const NotificationPreferenceModel: Model<NotificationPreferenceDoc> = defineModel<NotificationPreferenceDoc>(
  "NotificationPreference",
  schema,
);
