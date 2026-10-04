import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import {
  NOTIFICATION_ENTITIES,
  NOTIFICATION_TYPES,
  type NotificationAudience,
  type NotificationEntity,
  type NotificationType,
} from "@/lib/domain/notifications";
import { defineModel } from "./define";

/**
 * One in-app notification for one user. Historical: never deleted when the
 * underlying content/brand is archived. The link is NOT stored — it is
 * derived server-side from (type, entity) when read, so notification data
 * can never redirect anywhere outside the app.
 */
export interface NotificationDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  /** Rendered for this audience at creation (client-safe text for clients). */
  audience: NotificationAudience;
  type: NotificationType;
  title: string;
  message: string;
  entityType: NotificationEntity;
  entityId: Types.ObjectId;
  contentId: Types.ObjectId | null;
  brandId: Types.ObjectId | null;
  /** Business-event identity: retries of the same event never create a second row. */
  eventKey: string;
  reminder: boolean;
  readAt: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    audience: { type: String, enum: ["INTERNAL", "CLIENT"], required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 600 },
    entityType: { type: String, enum: NOTIFICATION_ENTITIES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", default: null },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", default: null },
    eventKey: { type: String, required: true, maxlength: 300 },
    reminder: { type: Boolean, required: true, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "notifications" },
);

// Inbox (all) and unread filtering, newest first.
notificationSchema.index({ agencyId: 1, recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ agencyId: 1, recipientUserId: 1, readAt: 1, createdAt: -1 });
// Idempotency: one notification per recipient per business event / reminder window.
notificationSchema.index({ agencyId: 1, recipientUserId: 1, eventKey: 1 }, { unique: true });

export const NotificationModel: Model<NotificationDoc> = defineModel<NotificationDoc>("Notification", notificationSchema);
