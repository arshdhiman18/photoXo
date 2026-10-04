"use server";

import { authedAction } from "@/server/actions/safe-action";
import { canManageSettings } from "@/server/authz/permissions";
import {
  getNotificationSummary,
  markAllNotificationsRead,
  setMyNotificationPreferences,
  setNotificationRead,
  updateReminderSettings,
} from "@/server/services/notifications.service";
import { emptySchema, notificationReadSchema, preferencesSchema, reminderSettingsSchema } from "./schemas";

// Every user may manage only their own notifications: the recipient is the
// session's user, never an input. No revalidatePath — the bell polls, and
// pages refresh themselves after these actions.

export const getNotificationSummaryAction = authedAction(emptySchema, (actor) => getNotificationSummary(actor));

export const setNotificationReadAction = authedAction(notificationReadSchema, (actor, input) =>
  setNotificationRead(actor, input.notificationId, input.read),
);

export const markAllNotificationsReadAction = authedAction(emptySchema, (actor) => markAllNotificationsRead(actor));

export const setNotificationPreferencesAction = authedAction(preferencesSchema, (actor, input) =>
  setMyNotificationPreferences(actor, input),
);

export const updateReminderSettingsAction = authedAction(
  reminderSettingsSchema,
  (actor, input) => updateReminderSettings(actor, input),
  { authorize: canManageSettings },
);
