import "server-only";
import type { Types } from "mongoose";
import { CRITICAL_NOTIFICATION_TYPES, OUTBOX_RETENTION_DAYS, UNREAD_NONCRITICAL_RETENTION_DAYS } from "@/lib/domain/notifications";
import { agencyIds, pruneNotifications, pruneOutbox, reminderSettingsFor } from "@/server/repositories/notifications.repo";

/**
 * Notification retention pass (scheduled job). Deletes ONLY notification and
 * email-outbox rows per the policy in src/lib/domain/notifications.ts; unread
 * critical notifications are never deleted. Business history (approvals,
 * postings, expenses, versions, activity log) is untouched.
 */
export async function runNotificationRetention(opts: { now?: Date; agencyId?: Types.ObjectId } = {}) {
  const now = opts.now ?? new Date();
  let read = 0;
  let unread = 0;
  for (const agencyId of opts.agencyId ? [opts.agencyId] : await agencyIds()) {
    const s = await reminderSettingsFor(agencyId);
    const r = await pruneNotifications(agencyId, now, s.readNotificationRetentionDays, CRITICAL_NOTIFICATION_TYPES, UNREAD_NONCRITICAL_RETENTION_DAYS);
    read += r.read;
    unread += r.unread;
  }
  const outbox = await pruneOutbox(now, OUTBOX_RETENTION_DAYS);
  return { read, unread, outbox };
}
