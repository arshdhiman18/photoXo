import "server-only";
import type { Types } from "mongoose";
import { NotificationType as T } from "@/lib/domain/notifications";
import { POSTING_PLATFORM_LABEL, targetPlatformsOf } from "@/lib/domain/postings";
import { formatCalendarDate, formatClock } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Actor } from "@/server/authz/actor";
import type { ContentDoc, ContentVersionDoc, ExpenseDoc, ProductionTaskDoc, ShootDoc } from "@/server/db/models";
import {
  activeOpsUserIds,
  brandInfo,
  brandPrimaryUploader,
  clientIdsOfBrand,
  internalApproverIds,
  taskAssigneeIds,
} from "@/server/repositories/notifications.repo";
import { resolveEffectiveUploader } from "@/server/repositories/postings.repo";
import { notify } from "./notify";

/*
 * Business-event → notification rules. Every recipient set is derived here
 * from server-side data (memberships, task assignments, approvals, uploader
 * resolution) — never from the browser. Called INSIDE the business
 * transaction of the event, right after the state change.
 */

type C = Pick<ContentDoc, "_id" | "agencyId" | "brandId" | "title" | "route" | "uploaderOverrideId" | "reviewSubmission"> &
  Partial<Pick<ContentDoc, "targetPlatforms">>;
type V = Pick<ContentVersionDoc, "_id" | "versionNumber">;

const contentEntity = (c: C) => ({ type: "CONTENT" as const, id: c._id });
const base = (c: C) => ({ agencyId: c.agencyId, brandId: c.brandId, contentId: c._id, entity: contentEntity(c) });

/** People doing the content's production work (version-producing task assignees) + who submitted it. */
async function productionOwners(c: C): Promise<Types.ObjectId[]> {
  const assignees = await taskAssigneeIds(c.agencyId, c._id);
  return c.reviewSubmission?.submittedBy ? [...assignees, c.reviewSubmission.submittedBy] : assignees;
}

/** Version submitted → ADMIN/MANAGER reviewers (agency-wide in the current role model). */
export async function onSubmittedForInternalReview(actor: Actor, c: C, v: V) {
  await notify({
    ...base(c),
    type: T.CONTENT_READY_FOR_INTERNAL_REVIEW,
    recipients: await activeOpsUserIds(c.agencyId),
    eventVersion: String(v._id),
    excludeUserId: actor.userId,
    ctx: { contentTitle: c.title, versionNumber: v.versionNumber },
  });
}

/** INTERNAL gate decided. */
export async function onInternalDecision(actor: Actor, c: C, v: V, approved: boolean, approvalId: Types.ObjectId, comment: string | null) {
  if (approved) {
    await notify({
      ...base(c),
      type: T.CONTENT_READY_FOR_CLIENT_APPROVAL,
      recipients: await clientIdsOfBrand(c.agencyId, c.brandId),
      eventVersion: String(approvalId),
      ctx: { contentTitle: c.title },
    });
    return;
  }
  await notify({
    ...base(c),
    type: T.CHANGES_REQUESTED_INTERNAL,
    recipients: await productionOwners(c),
    eventVersion: String(approvalId),
    excludeUserId: actor.userId,
    ctx: { contentTitle: c.title, versionNumber: v.versionNumber, comment },
  });
}

/** Content reached READY_TO_POST: the effective uploader, or ops when nobody valid is assigned. */
async function readyToPost(c: C, v: V, reminder = false, window = "0") {
  const brand = await brandInfo(c.agencyId, c.brandId);
  if (!brand) return;
  const u = await resolveEffectiveUploader(c.agencyId, { _id: c.brandId, primaryUploaderId: await primaryUploaderOf(c) }, c);
  const platforms = targetPlatformsOf(c).map((p) => POSTING_PLATFORM_LABEL[p]).join(", ");
  if (u.valid && u.userId) {
    await notify({
      ...base(c),
      type: T.CONTENT_READY_TO_POST,
      recipients: [u.userId],
      eventVersion: reminder ? `R:${window}` : String(v._id),
      reminder,
      ctx: { contentTitle: c.title, versionNumber: v.versionNumber, detail: platforms || undefined },
    });
  } else {
    await uploaderProblem(c, v, u.problem, reminder, window);
  }
}

const primaryUploaderOf = (c: C) => brandPrimaryUploader(c.agencyId, c.brandId);

const PROBLEM_TEXT = {
  NO_UPLOADER: "No uploader is assigned — it can't be posted until someone is.",
  INACTIVE_ACCOUNT: "The assigned uploader's account is inactive — reassign it.",
  NOT_AN_UPLOADER: "The assigned person is no longer an uploader on this brand — reassign it.",
} as const;

export async function uploaderProblem(c: C, v: V | null, problem: keyof typeof PROBLEM_TEXT | null, reminder = false, window = "0") {
  await notify({
    ...base(c),
    type: T.UPLOADER_ASSIGNMENT_PROBLEM,
    recipients: await activeOpsUserIds(c.agencyId),
    eventVersion: reminder ? `R:${window}` : String(v?._id ?? "none"),
    reminder,
    ctx: { contentTitle: c.title, detail: PROBLEM_TEXT[problem ?? "NO_UPLOADER"] },
  });
}

/** CLIENT gate decided (by the client, or recorded by an admin). */
export async function onClientDecision(actor: Actor, c: C, v: V, approved: boolean, approvalId: Types.ObjectId, comment: string | null) {
  const approvers = await internalApproverIds(c.agencyId, v._id);
  const owners = await productionOwners(c);
  if (approved) {
    await notify({
      ...base(c),
      type: T.CLIENT_APPROVED,
      recipients: [...approvers, ...owners],
      eventVersion: String(approvalId),
      excludeUserId: actor.userId,
      ctx: { contentTitle: c.title, versionNumber: v.versionNumber },
    });
    await readyToPost(c, v);
    return;
  }
  await notify({
    ...base(c),
    type: T.CHANGES_REQUESTED_CLIENT,
    recipients: [...owners, ...approvers],
    eventVersion: String(approvalId),
    ctx: { contentTitle: c.title, versionNumber: v.versionNumber, comment },
  });
}

/** Approved content sent back for changes before posting. */
export async function onReopenedForChanges(actor: Actor, c: C, v: V, approvalId: Types.ObjectId, reason: string) {
  const e = String(approvalId);
  await notify({
    ...base(c),
    type: T.CHANGES_REQUESTED_INTERNAL,
    recipients: await productionOwners(c),
    eventVersion: e,
    excludeUserId: actor.userId,
    ctx: { contentTitle: c.title, versionNumber: v.versionNumber, comment: reason },
  });
  await notify({ ...base(c), type: T.CONTENT_BEING_REVISED, recipients: await clientIdsOfBrand(c.agencyId, c.brandId), eventVersion: e, ctx: { contentTitle: c.title } });
  const u = await resolveEffectiveUploader(c.agencyId, { _id: c.brandId, primaryUploaderId: await primaryUploaderOf(c) }, c);
  if (u.valid && u.userId) {
    await notify({
      ...base(c),
      type: T.CONTENT_POSTING_PROBLEM,
      recipients: [u.userId],
      eventVersion: e,
      excludeUserId: actor.userId,
      ctx: { contentTitle: c.title, detail: "It was sent back for changes before posting — don't post it." },
    });
  }
}

/** Every required platform posted → content POSTED/COMPLETED. */
export async function onContentPosted(actor: Actor, c: C, v: V) {
  const approvers = await internalApproverIds(c.agencyId, v._id);
  const owners = await productionOwners(c);
  await notify({
    ...base(c),
    type: T.CONTENT_POSTED,
    recipients: [...owners, ...approvers, ...(await clientIdsOfBrand(c.agencyId, c.brandId))],
    eventVersion: String(v._id),
    excludeUserId: actor.userId,
    ctx: { contentTitle: c.title },
  });
}

// ── Production ────────────────────────────────────────────────────────────

const shootWhen = (s: Pick<ShootDoc, "date" | "startTime" | "endTime">) =>
  `${formatCalendarDate(s.date)}, ${formatClock(s.startTime)}–${formatClock(s.endTime)}`;
const shootBase = (s: Pick<ShootDoc, "_id" | "agencyId" | "brandId">) => ({
  agencyId: s.agencyId,
  brandId: s.brandId,
  contentId: null,
  entity: { type: "SHOOT" as const, id: s._id },
});
type S = Pick<ShootDoc, "_id" | "agencyId" | "brandId" | "title" | "date" | "startTime" | "endTime" | "crew">;
const activeCrewIds = (s: S) => s.crew.filter((c) => c.status !== "CANCELLED").map((c) => c.userId);

export async function onCrewAssigned(actor: Actor, s: S, entries: { userId: Types.ObjectId; assignedAt: Date }[]) {
  for (const e of entries) {
    await notify({
      ...shootBase(s),
      type: T.SHOOT_ASSIGNED,
      recipients: [e.userId],
      // One per assignment (re-adding someone later is a new event).
      eventVersion: `${String(e.userId)}:${e.assignedAt.getTime()}`,
      excludeUserId: actor.userId,
      ctx: { shootTitle: s.title, when: shootWhen(s) },
    });
  }
}

export async function onShootRescheduled(actor: Actor, s: S, revision: number) {
  await notify({
    ...shootBase(s),
    type: T.SHOOT_RESCHEDULED,
    recipients: activeCrewIds(s),
    eventVersion: `r${revision}`,
    excludeUserId: actor.userId,
    ctx: { shootTitle: s.title, when: shootWhen(s) },
  });
}

export async function onShootCancelled(actor: Actor, s: S) {
  await notify({
    ...shootBase(s),
    type: T.SHOOT_CANCELLED,
    recipients: activeCrewIds(s),
    eventVersion: "cancelled",
    excludeUserId: actor.userId,
    ctx: { shootTitle: s.title, when: shootWhen(s) },
  });
}

/** Shoot completed: assignees of tasks that were waiting on it can start. */
export async function onShootReady(actor: Actor, shootId: Types.ObjectId, tasks: Pick<ProductionTaskDoc, "_id" | "agencyId" | "brandId" | "contentId" | "assignedTo">[], titles: Map<string, string>) {
  for (const t of tasks) {
    if (!t.assignedTo) continue;
    await notify({
      agencyId: t.agencyId,
      brandId: t.brandId,
      contentId: t.contentId,
      entity: { type: "TASK", id: t._id },
      type: T.SHOOT_READY,
      recipients: [t.assignedTo],
      eventVersion: String(shootId),
      excludeUserId: actor.userId,
      ctx: { contentTitle: titles.get(String(t.contentId)) },
    });
  }
}

export async function onTaskAssigned(actor: Actor, t: Pick<ProductionTaskDoc, "_id" | "agencyId" | "brandId" | "contentId" | "title">, assignee: string, contentTitle: string) {
  await notify({
    agencyId: t.agencyId,
    brandId: t.brandId,
    contentId: t.contentId,
    entity: { type: "TASK", id: t._id },
    type: T.TASK_ASSIGNED,
    recipients: [assignee],
    // One per assignment; a retry within the same minute is the same event.
    eventVersion: `${assignee}:${Math.floor(Date.now() / 60_000)}`,
    excludeUserId: actor.userId,
    ctx: { contentTitle, detail: t.title },
  });
}

/** UPLOAD_RAW completed → editors on the same content. */
export async function onRawFootageReady(actor: Actor, t: Pick<ProductionTaskDoc, "_id" | "agencyId" | "brandId" | "contentId">, contentTitle: string) {
  await notify({
    agencyId: t.agencyId,
    brandId: t.brandId,
    contentId: t.contentId,
    entity: { type: "TASK", id: t._id },
    type: T.RAW_FOOTAGE_READY,
    recipients: await taskAssigneeIds(t.agencyId, t.contentId, ["EDIT"], true),
    eventVersion: String(t._id),
    excludeUserId: actor.userId,
    ctx: { contentTitle },
  });
}

export { readyToPost as notifyReadyToPost };

// ── Expenses ──────────────────────────────────────────────────────────────
// Expenses belong to a person, not a brand: notifications carry no brand
// (no brand-membership filtering), recipients are ops or the claimant only.

type E = Pick<ExpenseDoc, "_id" | "agencyId" | "userId" | "title" | "amountMinor" | "currency" | "submittedAt">;
const expenseLabel = (e: E) => `${e.title} (${formatMoney(e.amountMinor, e.currency)})`;

/** Submitted (or resubmitted) → ADMIN/MANAGER approvers, never the claimant. */
export async function onExpenseSubmitted(actor: Actor, e: E) {
  await notify({
    agencyId: e.agencyId,
    brandId: null,
    contentId: null,
    entity: { type: "EXPENSE", id: e._id },
    type: T.EXPENSE_SUBMITTED,
    recipients: await activeOpsUserIds(e.agencyId),
    eventVersion: String(e.submittedAt?.getTime() ?? Date.now()),
    excludeUserId: actor.userId,
    ctx: { expense: expenseLabel(e), person: actor.name },
  });
}

/** Approved / rejected → the claimant. One per decision (n = decision count). */
export async function onExpenseDecided(actor: Actor, e: E, approved: boolean, reason: string | null, n: number) {
  await notify({
    agencyId: e.agencyId,
    brandId: null,
    contentId: null,
    entity: { type: "EXPENSE", id: e._id },
    type: approved ? T.EXPENSE_APPROVED : T.EXPENSE_REJECTED,
    recipients: [e.userId],
    eventVersion: `d${n}`,
    excludeUserId: actor.userId,
    ctx: { expense: expenseLabel(e), comment: reason },
  });
}

/** Post-publication revision started: production owners act, clients see "being revised", the uploader stops. */
export async function onRevisionStarted(actor: Actor, c: C, v: V, revision: number, reason: string) {
  const e = `rev${revision}`;
  await notify({
    ...base(c),
    type: T.CHANGES_REQUESTED_INTERNAL,
    recipients: await productionOwners(c),
    eventVersion: e,
    excludeUserId: actor.userId,
    ctx: { contentTitle: c.title, versionNumber: v.versionNumber, comment: `New revision: ${reason}` },
  });
  await notify({ ...base(c), type: T.CONTENT_BEING_REVISED, recipients: await clientIdsOfBrand(c.agencyId, c.brandId), eventVersion: e, ctx: { contentTitle: c.title } });
  const u = await resolveEffectiveUploader(c.agencyId, { _id: c.brandId, primaryUploaderId: await primaryUploaderOf(c) }, c);
  if (u.valid && u.userId) {
    await notify({
      ...base(c),
      type: T.CONTENT_POSTING_PROBLEM,
      recipients: [u.userId],
      eventVersion: e,
      excludeUserId: actor.userId,
      ctx: { contentTitle: c.title, detail: "A new revision was started — don't post the old version anywhere else." },
    });
  }
}
