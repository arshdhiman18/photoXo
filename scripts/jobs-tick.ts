/**
 * Run one scheduled-jobs pass locally (reminders + email outbox delivery):
 *
 *   npm run jobs:tick
 *
 * Production calls GET/POST /api/jobs/tick with `Authorization: Bearer $CRON_SECRET`.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { runReminders } = await import("../src/server/notifications/reminders");
  const { deliverPendingEmails } = await import("../src/server/notifications/dispatch");
  await connectDb();
  try {
    const reminders = await runReminders();
    const emails = await deliverPendingEmails({ limit: 100 });
    const { runNotificationRetention } = await import("../src/server/notifications/retention");
    const retention = await runNotificationRetention();
    console.log(JSON.stringify({ reminders, emails, retention }));
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
