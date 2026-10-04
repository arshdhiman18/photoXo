import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { deliverPendingEmails } from "@/server/notifications/dispatch";
import { runReminders } from "@/server/notifications/reminders";
import { runNotificationRetention } from "@/server/notifications/retention";

/**
 * Scheduled job endpoint (reminders + email outbox delivery). Call it from a
 * scheduler (e.g. every 15 minutes) with `Authorization: Bearer $CRON_SECRET`.
 * Disabled (404) when CRON_SECRET is not configured. Idempotent: reminders
 * are windowed and emails are claimed with a lease, so overlapping or
 * repeated calls never duplicate anything.
 */
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function tick(req: Request) {
  if (!env.CRON_SECRET) return new Response("Not found", { status: 404 });
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const reminders = await runReminders();
  const emails = await deliverPendingEmails({ limit: 100 });
  const retention = await runNotificationRetention();
  return Response.json({ ok: true, reminders, emails, retention });
}

export const GET = tick;
export const POST = tick;
