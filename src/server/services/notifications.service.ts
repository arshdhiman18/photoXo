import "server-only";
import type { z } from "zod";
import type { NotificationDTO, NotificationInboxDTO, NotificationSummaryDTO } from "@/features/notifications/types";
import type { preferencesSchema, reminderSettingsSchema } from "@/features/notifications/schemas";
import { INBOX_PAGE_SIZE, notificationHref, type ReminderSettings } from "@/lib/domain/notifications";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/authz/errors";
import { assertCan, canManageSettings } from "@/server/authz/permissions";
import type { NotificationDoc } from "@/server/db/models";
import {
  getPreference,
  markAllReadFor,
  notificationsRepo,
  reminderSettingsFor,
  savePreference,
  saveReminderSettings,
  unreadCountFor,
} from "@/server/repositories/notifications.repo";

/*
 * Personal notification reads/writes. Everything goes through the scoped
 * repository (agency + recipient = the signed-in user), so another user's
 * notification id is simply not found. Read-state changes are not audited
 * (they are not business events).
 */

/** Allow-list serializer. The link is derived for THIS viewer's role; nothing else internal is exposed. */
function toDTO(n: NotificationDoc, actor: Actor): NotificationDTO {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    message: n.message,
    href: notificationHref(
      { type: n.type, entityType: n.entityType, entityId: String(n.entityId), contentId: n.contentId ? String(n.contentId) : null },
      actor.systemRole,
    ),
    reminder: n.reminder,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listMyNotifications(
  actor: Actor,
  opts: { page?: number; unreadOnly?: boolean } = {},
): Promise<NotificationInboxDTO> {
  const page = Math.max(1, Math.min(opts.page ?? 1, 500));
  const filter = opts.unreadOnly ? { readAt: null } : {};
  const [rows, unread] = await Promise.all([
    notificationsRepo.find(actor, filter, {
      sort: { createdAt: -1 },
      skip: (page - 1) * INBOX_PAGE_SIZE,
      limit: INBOX_PAGE_SIZE + 1, // one extra to know whether there is a next page
    }),
    unreadCountFor(actor.agencyId, actor.userId),
  ]);
  return {
    items: rows.slice(0, INBOX_PAGE_SIZE).map((n) => toDTO(n, actor)),
    page,
    hasMore: rows.length > INBOX_PAGE_SIZE,
    unread,
  };
}

/** Bell: server-derived unread count + the latest few. */
export async function getNotificationSummary(actor: Actor): Promise<NotificationSummaryDTO> {
  const [recent, unread] = await Promise.all([
    notificationsRepo.find(actor, {}, { sort: { createdAt: -1 }, limit: 6 }),
    unreadCountFor(actor.agencyId, actor.userId),
  ]);
  return { unread, recent: recent.map((n) => toDTO(n, actor)) };
}

export async function getUnreadCount(actor: Actor): Promise<number> {
  return unreadCountFor(actor.agencyId, actor.userId);
}

export async function setNotificationRead(actor: Actor, notificationId: string, read: boolean): Promise<void> {
  const updated = await notificationsRepo.updateById(actor, notificationId, { $set: { readAt: read ? new Date() : null } });
  if (!updated) throw new NotFoundError(); // not yours / not found — same answer, no contents leaked
}

export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  return markAllReadFor(actor.agencyId, actor.userId);
}

export function getMyNotificationPreferences(actor: Actor) {
  return getPreference(actor.agencyId, actor.userId);
}

export async function setMyNotificationPreferences(actor: Actor, input: z.output<typeof preferencesSchema>) {
  await savePreference(actor.agencyId, actor.userId, input);
}

export async function getReminderSettings(actor: Actor): Promise<ReminderSettings> {
  assertCan(canManageSettings(actor));
  return reminderSettingsFor(actor.agencyId);
}

export async function updateReminderSettings(actor: Actor, input: z.output<typeof reminderSettingsSchema>) {
  assertCan(canManageSettings(actor));
  await saveReminderSettings(actor.agencyId, input);
}
