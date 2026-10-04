import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/domain/notifications";
import { defineModel } from "./define";

export type EmailOutboxStatus = "PENDING" | "SENDING" | "SENT" | "FAILED";

/**
 * Outbox row written in the SAME transaction as the notification. Delivery
 * happens later, outside any business transaction (dispatcher), so a failing
 * provider can never roll back or block the business change.
 */
export interface EmailOutboxDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  notificationId: Types.ObjectId;
  type: NotificationType;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** = recipient + notification eventKey: an event is never emailed twice. */
  dedupeKey: string;
  status: EmailOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  /** Claim lease while SENDING; an expired lease is retried (crash safety). */
  lockedUntil: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  providerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailOutboxSchema = new Schema<EmailOutboxDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    notificationId: { type: Schema.Types.ObjectId, ref: "Notification", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    to: { type: String, required: true, maxlength: 320 },
    subject: { type: String, required: true, maxlength: 300 },
    text: { type: String, required: true, maxlength: 5000 },
    html: { type: String, required: true, maxlength: 20000 },
    dedupeKey: { type: String, required: true, maxlength: 400 },
    status: { type: String, enum: ["PENDING", "SENDING", "SENT", "FAILED"], required: true },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    sentAt: { type: Date, default: null },
    providerId: { type: String, default: null },
  },
  { timestamps: true, collection: "emailOutbox" },
);

// Dispatcher: due work by status + next attempt.
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
// Operational views / cleanup per agency.
emailOutboxSchema.index({ agencyId: 1, createdAt: -1 });
// Never enqueue the same event email twice.
emailOutboxSchema.index({ agencyId: 1, dedupeKey: 1 }, { unique: true });

export const EmailOutboxModel: Model<EmailOutboxDoc> = defineModel<EmailOutboxDoc>("EmailOutbox", emailOutboxSchema);
