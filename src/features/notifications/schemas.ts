import { z } from "zod";
import { REMINDER_LIMITS, RETENTION_LIMITS } from "@/lib/domain/notifications";
import { objectIdString } from "@/lib/validation";

// Strict: recipientUserId / agencyId / userId are never accepted — the
// recipient is always the signed-in user.

export const notificationReadSchema = z.object({ notificationId: objectIdString, read: z.boolean() }).strict();

export const emptySchema = z.object({}).strict();

export const preferencesSchema = z.object({ inAppEnabled: z.boolean(), emailEnabled: z.boolean() }).strict();

const hours = (min: number) =>
  z.coerce
    .number({ error: "Enter a number of hours" })
    .int("Whole hours only")
    .min(min, `At least ${min}`)
    .max(REMINDER_LIMITS.max, `At most ${REMINDER_LIMITS.max}`);

export const reminderSettingsSchema = z
  .object({
    approvalWaitingHours: hours(REMINDER_LIMITS.min),
    readyToPostHours: hours(REMINDER_LIMITS.min),
    overdueGraceHours: hours(0),
    repeatEveryHours: hours(REMINDER_LIMITS.min),
    readNotificationRetentionDays: z.coerce
      .number({ error: "Enter a number of days" })
      .int("Whole days only")
      .min(RETENTION_LIMITS.min, `At least ${RETENTION_LIMITS.min}`)
      .max(RETENTION_LIMITS.max, `At most ${RETENTION_LIMITS.max}`),
  })
  .strict();
