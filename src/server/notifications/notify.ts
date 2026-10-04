import "server-only";
import type { Types } from "mongoose";
import { env } from "@/lib/env";
import {
  NOTIFICATION_TYPE_DEFS,
  notificationHref,
  type NotificationAudience,
  type NotificationEntity,
  type NotificationType,
} from "@/lib/domain/notifications";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import { renderNotificationEmail } from "@/server/email/templates";
import {
  activeBrandMemberIds,
  activeUsers,
  agencyName,
  brandInfo,
  enqueueEmails,
  preferencesFor,
  upsertNotifications,
} from "@/server/repositories/notifications.repo";
import { toObjectId } from "@/server/repositories/scoped-repository";
import { scheduleEmailDelivery } from "./dispatch";
import { renderNotification, type NotificationContext } from "./templates";

type Id = Types.ObjectId | string | null | undefined;

export interface NotifyInput {
  agencyId: Types.ObjectId;
  type: NotificationType;
  entity: { type: NotificationEntity; id: Types.ObjectId };
  contentId?: Types.ObjectId | null;
  brandId: Types.ObjectId | null;
  /** Candidate recipients, resolved by the caller from SERVER-SIDE business rules only. */
  recipients: Id[];
  /** Distinguishes one occurrence of the event from another (idempotency). */
  eventVersion: string;
  /** Never notify the person who caused the event. */
  excludeUserId?: string | null;
  reminder?: boolean;
  ctx: NotificationContext;
}

const isOps = (role: SystemRole) => role === SystemRole.ADMIN || role === SystemRole.MANAGER;
const audienceOf = (role: SystemRole): NotificationAudience => (role === SystemRole.CLIENT ? "CLIENT" : "INTERNAL");

/**
 * Create notifications for one business event. Call it INSIDE the business
 * transaction: rows (and email outbox rows) commit or roll back with the
 * change. Recipients are filtered again here:
 *   · ACTIVE users of the same agency only
 *   · audience must be allowed for the type (clients never get internal types)
 *   · non-ops users need an ACTIVE membership on the brand (CLIENT membership
 *     for clients) — removed members get nothing
 *   · archived brands generate no new notifications
 *   · user preferences: non-critical in-app can be turned off; email only if on
 * Idempotent per (recipient, eventKey). Never sends email inline.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const def = NOTIFICATION_TYPE_DEFS[input.type];
  const ids = [...new Set(input.recipients.filter(Boolean).map(String))].filter((id) => id !== input.excludeUserId);
  if (ids.length === 0) return 0;

  let brandName = "";
  let members: Set<string> | null = null;
  let clientMembers: Set<string> | null = null;
  if (input.brandId) {
    const brand = await brandInfo(input.agencyId, input.brandId);
    if (!brand || !brand.active) return 0;
    brandName = brand.name;
  }
  const users = await activeUsers(input.agencyId, ids.map(toObjectId).filter((id): id is Types.ObjectId => Boolean(id)));
  if (input.brandId && users.some((u) => !isOps(u.role))) {
    [members, clientMembers] = await Promise.all([
      activeBrandMemberIds(input.agencyId, input.brandId),
      activeBrandMemberIds(input.agencyId, input.brandId, [BrandRole.CLIENT]),
    ]);
  }
  const eligible = users.filter((u) => {
    const audience = audienceOf(u.role);
    if (!def.audiences.includes(audience)) return false;
    if (isOps(u.role) || !input.brandId) return true;
    return audience === "CLIENT" ? Boolean(clientMembers?.has(u.id)) : Boolean(members?.has(u.id) && !clientMembers?.has(u.id));
  });
  if (eligible.length === 0) return 0;

  const prefs = await preferencesFor(input.agencyId, eligible.map((u) => u.id));
  const eventKey = `${input.type}:${String(input.entity.id)}:${input.eventVersion}`;
  const rows = eligible.flatMap((u) => {
    const p = prefs(u.id);
    if (!def.critical && !p.inAppEnabled) return [];
    const audience = audienceOf(u.role);
    const text = renderNotification(input.type, audience, input.ctx, brandName, Boolean(input.reminder));
    if (!text) return [];
    return [
      {
        user: u,
        doc: {
          agencyId: input.agencyId,
          recipientUserId: toObjectId(u.id)!,
          audience,
          type: input.type,
          title: text.title,
          message: text.message,
          entityType: input.entity.type,
          entityId: input.entity.id,
          contentId: input.contentId ?? null,
          brandId: input.brandId,
          eventKey,
          reminder: Boolean(input.reminder),
        },
      },
    ];
  });
  const created = await upsertNotifications(rows.map((r) => r.doc));
  if (created.length === 0 || !def.email) return created.length;

  const byRecipient = new Map(rows.map((r) => [String(r.doc.recipientUserId), r.user]));
  const name = (await agencyName(input.agencyId)) ?? "your agency";
  const emails = created.flatMap((n) => {
    const u = byRecipient.get(String(n.recipientUserId));
    if (!u || !prefs(u.id).emailEnabled) return [];
    const path = notificationHref(
      { type: n.type, entityType: n.entityType, entityId: String(n.entityId), contentId: n.contentId ? String(n.contentId) : null },
      u.role,
    );
    const mail = renderNotificationEmail({ title: n.title, message: n.message, url: `${env.APP_URL}${path}`, agencyName: name });
    return [
      {
        agencyId: input.agencyId,
        recipientUserId: n.recipientUserId,
        notificationId: n._id,
        type: n.type,
        to: u.email,
        ...mail,
        dedupeKey: `${u.id}:${n.eventKey}`,
        nextAttemptAt: new Date(),
      },
    ];
  });
  if ((await enqueueEmails(emails)) > 0) scheduleEmailDelivery();
  return created.length;
}
