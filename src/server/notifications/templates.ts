import "server-only";
import type { NotificationAudience, NotificationType } from "@/lib/domain/notifications";

/** Values a notification may mention. Client templates read ONLY contentTitle and brandName. */
export interface NotificationContext {
  contentTitle?: string;
  shootTitle?: string;
  versionNumber?: number;
  /** Shoot date/time, already formatted. */
  when?: string;
  /** Internal-only free text (e.g. a change-request comment). Never used by client templates. */
  comment?: string | null;
  /** Internal-only short detail ("Instagram, YouTube", "waiting 3 days"). */
  detail?: string;
  /** Expense title + formatted amount (internal only). */
  expense?: string;
  person?: string;
}

const clip = (s: string | null | undefined, n = 160) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : "");
const v = (ctx: NotificationContext) => (ctx.versionNumber ? `V${ctx.versionNumber}` : "The latest version");

type Rendered = { title: string; message: string };

/**
 * Client-facing copy. Deliberately generic: title of the content and the
 * brand, nothing about people, comments, tasks, shoots or uploaders.
 */
function clientCopy(type: NotificationType, content: string, brand: string, reminder: boolean): Rendered | null {
  const where = `${content} · ${brand}`;
  switch (type) {
    case "CONTENT_READY_FOR_CLIENT_APPROVAL":
      return { title: reminder ? "Reminder: content is waiting for your approval" : "New content is ready for your approval", message: where };
    case "CONTENT_BEING_REVISED":
      return { title: "Your content is being revised", message: where };
    case "CONTENT_POSTED":
      return { title: "Your content has been posted", message: where };
    default:
      return null; // no client copy → never sent to clients
  }
}

function internalCopy(type: NotificationType, ctx: NotificationContext, brand: string): Rendered {
  const content = ctx.contentTitle ?? "Content";
  const shoot = ctx.shootTitle ?? "Shoot";
  switch (type) {
    case "SHOOT_ASSIGNED":
      return { title: `You're on a shoot: ${shoot}`, message: `${brand} · ${ctx.when ?? ""}`.trim() };
    case "SHOOT_RESCHEDULED":
      return { title: `Shoot moved: ${shoot}`, message: `${brand} · now ${ctx.when ?? ""}`.trim() };
    case "SHOOT_CANCELLED":
      return { title: `Shoot cancelled: ${shoot}`, message: `${brand} · was ${ctx.when ?? ""}`.trim() };
    case "SHOOT_READY":
      return { title: `Shoot done — you're up: ${content}`, message: `${brand} · the shoot is complete, so your task is unblocked.` };
    case "RAW_FOOTAGE_READY":
      return { title: `Raw footage ready: ${content}`, message: `${brand} · the raw upload is done — you can start editing.` };
    case "TASK_ASSIGNED":
      return { title: `New task: ${ctx.detail ?? "Task"}`, message: `${brand} · ${content}` };
    case "CONTENT_READY_FOR_INTERNAL_REVIEW":
      return { title: `Ready for review: ${content}`, message: `${brand} · ${v(ctx)} was submitted for internal review.` };
    case "CHANGES_REQUESTED_INTERNAL":
      return { title: `Changes requested: ${content}`, message: `${brand} · ${v(ctx)}: ${clip(ctx.comment)}` };
    case "CHANGES_REQUESTED_CLIENT":
      return { title: `Client asked for changes: ${content}`, message: `${brand} · ${v(ctx)}: ${clip(ctx.comment)}` };
    case "CLIENT_APPROVED":
      return { title: `Client approved: ${content}`, message: `${brand} · ${v(ctx)} is approved and moves to posting.` };
    case "CONTENT_BEING_REVISED":
      return { title: `Being revised: ${content}`, message: brand };
    case "CONTENT_READY_TO_POST":
      return { title: `Ready to post: ${content}`, message: `${brand} · post ${v(ctx)} to ${ctx.detail ?? "the required platforms"}.` };
    case "CONTENT_POSTING_PROBLEM":
      return { title: `Posting paused: ${content}`, message: `${brand} · ${ctx.detail ?? "this item is no longer ready to post."}` };
    case "CONTENT_POSTED":
      return { title: `Posted: ${content}`, message: `${brand} · live on every required platform.` };
    case "UPLOADER_ASSIGNMENT_PROBLEM":
      return { title: `Needs an uploader: ${content}`, message: `${brand} · ${ctx.detail ?? "no valid uploader is assigned."}` };
    case "OVERDUE_ITEM":
      return { title: `Overdue: ${ctx.shootTitle ?? content}`, message: `${brand} · ${ctx.detail ?? "past its due date."}` };
    case "EXPENSE_SUBMITTED":
      return { title: `Expense to review: ${ctx.expense ?? ""}`.trim(), message: `${ctx.person ?? "Someone"} submitted an expense${brand ? ` · ${brand}` : ""}.` };
    case "EXPENSE_APPROVED":
      return { title: `Expense approved: ${ctx.expense ?? ""}`.trim(), message: "Your expense was approved." };
    case "EXPENSE_REJECTED":
      return { title: `Expense rejected: ${ctx.expense ?? ""}`.trim(), message: `Reason: ${clip(ctx.comment)} — you can correct it and resubmit.` };
    default:
      return { title: content, message: brand };
  }
}

export function renderNotification(
  type: NotificationType,
  audience: NotificationAudience,
  ctx: NotificationContext,
  brandName: string,
  reminder: boolean,
): Rendered | null {
  if (audience === "CLIENT") return clientCopy(type, ctx.contentTitle ?? "Your content", brandName, reminder);
  const r = internalCopy(type, ctx, brandName);
  // Overdue items are reminders by nature — no double "Reminder: Overdue:" label.
  return reminder && type !== "OVERDUE_ITEM" ? { ...r, title: `Reminder: ${r.title}` } : r;
}
