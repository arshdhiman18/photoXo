import "server-only";
import type { Actor } from "@/server/authz/actor";
import { getAgencyContext } from "@/server/services/agency.service";
import { getMyNotificationPreferences, listMyNotifications } from "@/server/services/notifications.service";

/** Shared by the three inbox routes (work, admin, client). Always the signed-in user's own data. */
export async function loadInbox(actor: Actor, raw: Record<string, string | string[] | undefined>) {
  const unreadOnly = raw.filter === "unread";
  const page = Number.parseInt(typeof raw.page === "string" ? raw.page : "1", 10);
  const [data, prefs, agency] = await Promise.all([
    listMyNotifications(actor, { page: Number.isFinite(page) ? page : 1, unreadOnly }),
    getMyNotificationPreferences(actor),
    getAgencyContext(actor),
  ]);
  return { data, prefs, unreadOnly, timeZone: agency.timezone };
}
