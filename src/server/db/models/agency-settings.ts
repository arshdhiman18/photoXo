import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { DEFAULT_REMINDER_SETTINGS, REMINDER_LIMITS, RETENTION_LIMITS, type ReminderSettings } from "@/lib/domain/notifications";
import { defineModel } from "./define";

/**
 * Agency-configurable business rules (Stage 0 `agencySettings`). One document
 * per agency, created lazily — a missing document means "all defaults".
 * Stage 7 adds only the reminder thresholds it needs.
 */
export interface AgencySettingsDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  reminders: ReminderSettings;
  createdAt: Date;
  updatedAt: Date;
}

const hours = (d: number) => ({ type: Number, required: true, default: d, min: REMINDER_LIMITS.min, max: REMINDER_LIMITS.max });

const agencySettingsSchema = new Schema<AgencySettingsDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    reminders: {
      approvalWaitingHours: hours(DEFAULT_REMINDER_SETTINGS.approvalWaitingHours),
      readyToPostHours: hours(DEFAULT_REMINDER_SETTINGS.readyToPostHours),
      overdueGraceHours: { type: Number, required: true, default: DEFAULT_REMINDER_SETTINGS.overdueGraceHours, min: 0, max: REMINDER_LIMITS.max },
      repeatEveryHours: hours(DEFAULT_REMINDER_SETTINGS.repeatEveryHours),
      readNotificationRetentionDays: {
        type: Number,
        required: true,
        default: DEFAULT_REMINDER_SETTINGS.readNotificationRetentionDays,
        min: RETENTION_LIMITS.min,
        max: RETENTION_LIMITS.max,
      },
    },
  },
  { timestamps: true, collection: "agencySettings" },
);

agencySettingsSchema.index({ agencyId: 1 }, { unique: true });

export const AgencySettingsModel: Model<AgencySettingsDoc> = defineModel<AgencySettingsDoc>("AgencySettings", agencySettingsSchema);
