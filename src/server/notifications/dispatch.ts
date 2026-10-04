import "server-only";
import { after } from "next/server";
import { sendEmail } from "@/server/email/transport";
import { claimDueEmail, finishEmail, recipientStillReachable } from "@/server/repositories/notifications.repo";

const MAX_ATTEMPTS = 5;
const backoffMs = (attempts: number) => Math.min(60, 2 ** attempts) * 60_000; // 2, 4, 8 … ≤ 60 min

/**
 * Deliver due outbox emails, one claimed row at a time, OUTSIDE any business
 * transaction. A claim is an atomic lease, so two dispatchers never send the
 * same row; a crashed send is retried after the lease expires. Provider
 * failures are retried with backoff, then marked FAILED and logged
 * operationally — they never affect the business change that queued them.
 */
export async function deliverPendingEmails(opts: { now?: Date; limit?: number } = {}): Promise<{ sent: number; failed: number; skipped: number }> {
  const limit = opts.limit ?? 25;
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < limit; i++) {
    const now = opts.now ?? new Date();
    const row = await claimDueEmail(now);
    if (!row) break;
    // Preferences / account status may have changed since the email was queued.
    if (!(await recipientStillReachable(row.agencyId, row.recipientUserId))) {
      await finishEmail(row._id, { status: "FAILED", lastError: "skipped: recipient inactive or email turned off" });
      result.skipped++;
      continue;
    }
    try {
      const delivery = await sendEmail({ to: row.to, subject: row.subject, text: row.text, html: row.html });
      await finishEmail(row._id, {
        status: "SENT",
        sentAt: new Date(),
        providerId: delivery.status === "sent" ? delivery.id : "logged",
        lastError: null,
      });
      result.sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const final = row.attempts >= MAX_ATTEMPTS;
      await finishEmail(row._id, {
        status: final ? "FAILED" : "PENDING",
        lastError: message.slice(0, 500),
        nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
      });
      if (final) console.error(`[email] giving up on outbox ${String(row._id)} (${row.type}) after ${row.attempts} attempts: ${message}`);
      result.failed++;
    }
  }
  return result;
}

/**
 * Ask the runtime to deliver queued emails after the current response.
 * Outside a request (tests, scripts) this is a no-op — the scheduled job
 * (/api/jobs/tick) delivers instead.
 */
export function scheduleEmailDelivery() {
  try {
    after(() => deliverPendingEmails({ limit: 20 }).catch((e) => console.error("[email] dispatch failed", e)));
  } catch {
    // not in a request scope
  }
}
