/**
 * Notification domain — the ONLY place notification types, audiences, email
 * eligibility and reminder defaults are defined. Services emit by type; they
 * never invent type strings, recipients' roles or link targets.
 */

export const NotificationType = {
  // Production
  SHOOT_ASSIGNED: "SHOOT_ASSIGNED",
  SHOOT_RESCHEDULED: "SHOOT_RESCHEDULED",
  SHOOT_CANCELLED: "SHOOT_CANCELLED",
  /** The shoot is complete — work waiting on it is unblocked. */
  SHOOT_READY: "SHOOT_READY",
  RAW_FOOTAGE_READY: "RAW_FOOTAGE_READY",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  // Approval
  CONTENT_READY_FOR_INTERNAL_REVIEW: "CONTENT_READY_FOR_INTERNAL_REVIEW",
  CONTENT_READY_FOR_CLIENT_APPROVAL: "CONTENT_READY_FOR_CLIENT_APPROVAL",
  CHANGES_REQUESTED_INTERNAL: "CHANGES_REQUESTED_INTERNAL",
  CHANGES_REQUESTED_CLIENT: "CHANGES_REQUESTED_CLIENT",
  CLIENT_APPROVED: "CLIENT_APPROVED",
  /** Client-facing: approved content is being revised (sent back before posting). */
  CONTENT_BEING_REVISED: "CONTENT_BEING_REVISED",
  // Posting
  CONTENT_READY_TO_POST: "CONTENT_READY_TO_POST",
  CONTENT_POSTING_PROBLEM: "CONTENT_POSTING_PROBLEM",
  CONTENT_POSTED: "CONTENT_POSTED",
  // Operations
  UPLOADER_ASSIGNMENT_PROBLEM: "UPLOADER_ASSIGNMENT_PROBLEM",
  OVERDUE_ITEM: "OVERDUE_ITEM",
  // Expenses
  EXPENSE_SUBMITTED: "EXPENSE_SUBMITTED",
  EXPENSE_APPROVED: "EXPENSE_APPROVED",
  EXPENSE_REJECTED: "EXPENSE_REJECTED",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export const NOTIFICATION_TYPES = Object.values(NotificationType);

export type NotificationAudience = "INTERNAL" | "CLIENT";
export type NotificationCategory = "PRODUCTION" | "APPROVAL" | "POSTING" | "OPERATIONS" | "EXPENSES";

export interface NotificationTypeDef {
  category: NotificationCategory;
  /** Which kinds of user may EVER receive it. Enforced again at creation. */
  audiences: NotificationAudience[];
  /**
   * Operationally critical: created in-app even when the user turned off
   * non-essential in-app notifications.
   */
  critical: boolean;
  /** Also sent by email (if the user's email preference is on). Kept deliberately small. */
  email: boolean;
}

export const NOTIFICATION_TYPE_DEFS: Record<NotificationType, NotificationTypeDef> = {
  SHOOT_ASSIGNED: { category: "PRODUCTION", audiences: ["INTERNAL"], critical: true, email: false },
  SHOOT_RESCHEDULED: { category: "PRODUCTION", audiences: ["INTERNAL"], critical: true, email: false },
  SHOOT_CANCELLED: { category: "PRODUCTION", audiences: ["INTERNAL"], critical: true, email: false },
  SHOOT_READY: { category: "PRODUCTION", audiences: ["INTERNAL"], critical: false, email: false },
  RAW_FOOTAGE_READY: { category: "PRODUCTION", audiences: ["INTERNAL"], critical: false, email: false },
  TASK_ASSIGNED: { category: "PRODUCTION", audiences: ["INTERNAL"], critical: true, email: false },
  CONTENT_READY_FOR_INTERNAL_REVIEW: { category: "APPROVAL", audiences: ["INTERNAL"], critical: false, email: false },
  CONTENT_READY_FOR_CLIENT_APPROVAL: { category: "APPROVAL", audiences: ["CLIENT"], critical: true, email: true },
  CHANGES_REQUESTED_INTERNAL: { category: "APPROVAL", audiences: ["INTERNAL"], critical: true, email: false },
  CHANGES_REQUESTED_CLIENT: { category: "APPROVAL", audiences: ["INTERNAL"], critical: true, email: true },
  CLIENT_APPROVED: { category: "APPROVAL", audiences: ["INTERNAL"], critical: false, email: false },
  CONTENT_BEING_REVISED: { category: "APPROVAL", audiences: ["CLIENT"], critical: false, email: false },
  CONTENT_READY_TO_POST: { category: "POSTING", audiences: ["INTERNAL"], critical: true, email: true },
  CONTENT_POSTING_PROBLEM: { category: "POSTING", audiences: ["INTERNAL"], critical: true, email: false },
  CONTENT_POSTED: { category: "POSTING", audiences: ["INTERNAL", "CLIENT"], critical: false, email: false },
  UPLOADER_ASSIGNMENT_PROBLEM: { category: "OPERATIONS", audiences: ["INTERNAL"], critical: true, email: true },
  OVERDUE_ITEM: { category: "OPERATIONS", audiences: ["INTERNAL"], critical: true, email: true },
  EXPENSE_SUBMITTED: { category: "EXPENSES", audiences: ["INTERNAL"], critical: false, email: false },
  EXPENSE_APPROVED: { category: "EXPENSES", audiences: ["INTERNAL"], critical: false, email: false },
  EXPENSE_REJECTED: { category: "EXPENSES", audiences: ["INTERNAL"], critical: true, email: false },
};

/** What a notification is about. Links are derived from this server-side — never stored. */
export const NotificationEntity = { CONTENT: "CONTENT", SHOOT: "SHOOT", TASK: "TASK", EXPENSE: "EXPENSE" } as const;
export type NotificationEntity = (typeof NotificationEntity)[keyof typeof NotificationEntity];
export const NOTIFICATION_ENTITIES = Object.values(NotificationEntity);

// ── Reminders ─────────────────────────────────────────────────────────────

/** Agency reminder settings (hours). Defaults follow the Stage 0 design. */
export interface ReminderSettings {
  /** Content waiting in INTERNAL_REVIEW / CLIENT_REVIEW longer than this gets a reminder. */
  approvalWaitingHours: number;
  /** Client-approved content not fully posted after this long. */
  readyToPostHours: number;
  /** Grace after a due date / shoot end before an item counts as overdue. */
  overdueGraceHours: number;
  /** An unresolved item is reminded again at most once per this window. */
  repeatEveryHours: number;
  /** READ notifications older than this many days are deleted (business records are never affected). */
  readNotificationRetentionDays: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  approvalWaitingHours: 72,
  readyToPostHours: 24,
  overdueGraceHours: 2,
  repeatEveryHours: 24,
  readNotificationRetentionDays: 180,
};

/**
 * Notification retention (applied by the scheduled job):
 *  - READ notifications: deleted after `readNotificationRetentionDays`
 *  - UNREAD non-critical: deleted after UNREAD_NONCRITICAL_RETENTION_DAYS
 *  - UNREAD critical: never deleted automatically
 *  - email outbox: SENT / FAILED rows deleted after OUTBOX_RETENTION_DAYS
 * Only notification/outbox rows are removed. Approvals, postings, expenses,
 * versions and the activity log are business history and are never touched.
 */
export const UNREAD_NONCRITICAL_RETENTION_DAYS = 365;
export const OUTBOX_RETENTION_DAYS = 30;
export const RETENTION_LIMITS = { min: 30, max: 3650 } as const;
export const CRITICAL_NOTIFICATION_TYPES = (Object.keys(NOTIFICATION_TYPE_DEFS) as NotificationType[]).filter(
  (t) => NOTIFICATION_TYPE_DEFS[t].critical,
);

export const REMINDER_LIMITS = { min: 1, max: 24 * 30 } as const;

/**
 * Deterministic reminder window: no reminder before `threshold` has passed
 * since `since`; then one per `repeat` window. Returns null when not due.
 * Re-entering a state (new `since`) starts a fresh series.
 */
export function reminderWindow(since: Date, now: Date, thresholdHours: number, repeatHours: number): number | null {
  const elapsed = now.getTime() - since.getTime() - thresholdHours * 3_600_000;
  if (elapsed < 0) return null;
  return Math.floor(elapsed / (Math.max(1, repeatHours) * 3_600_000));
}

export const INBOX_PAGE_SIZE = 20;

// ── Links (derived, never stored) ─────────────────────────────────────────

const HEX_ID = /^[a-f0-9]{24}$/;

/**
 * The in-app destination for a notification, resolved from its type and
 * entity for the RECIPIENT's role. Always an internal absolute path built
 * from validated ids — notification data can never point outside the app.
 */
export function notificationHref(
  n: { type: NotificationType; entityType: NotificationEntity; entityId: string; contentId: string | null },
  role: "ADMIN" | "MANAGER" | "STAFF" | "CLIENT",
): string {
  const ops = role === "ADMIN" || role === "MANAGER";
  const content = n.contentId && HEX_ID.test(n.contentId) ? n.contentId : null;
  const entity = HEX_ID.test(n.entityId) ? n.entityId : null;
  if (role === "CLIENT") return content ? `/client/content/${content}` : "/client/approvals";
  if (n.entityType === "SHOOT" && entity) return ops ? `/admin/shoots/${entity}` : `/work/shoots/${entity}`;
  if (n.entityType === "EXPENSE" && entity) {
    // Decisions go to the claimant's own view; submissions to the approval view.
    return n.type === "EXPENSE_SUBMITTED" && ops ? `/admin/expenses/${entity}` : `/work/expenses/${entity}`;
  }
  if (!content) return ops ? "/admin/inbox" : "/work/inbox";
  if (n.type === "CONTENT_READY_TO_POST" || n.type === "CONTENT_POSTING_PROBLEM") return `/work/to-post/${content}`;
  return ops ? `/admin/content/${content}` : `/work/content/${content}`;
}
