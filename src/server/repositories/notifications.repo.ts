import "server-only";
import { Types } from "mongoose";
import { BrandStatus, MembershipStatus } from "@/lib/domain/brands";
import { DEFAULT_REMINDER_SETTINGS, type NotificationType, type ReminderSettings } from "@/lib/domain/notifications";
import { BrandRole, SystemRole, UserStatus } from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import { VERSION_TASK_TYPES, type ContentStatus, type TaskType } from "@/lib/domain/content";
import {
  AgencyModel,
  AgencySettingsModel,
  ApprovalModel,
  ContentModel,
  ContentVersionModel,
  ProductionTaskModel,
  ShootModel,
  type ContentDoc,
  type ProductionTaskDoc,
  type ShootDoc,
  BrandMembershipModel,
  BrandModel,
  EmailOutboxModel,
  NotificationModel,
  NotificationPreferenceModel,
  UserModel,
  type EmailOutboxDoc,
  type NotificationDoc,
} from "@/server/db/models";
import { defineScopedRepository } from "./scoped-repository";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

/**
 * Notifications are strictly personal: every read and write is constrained
 * to { agencyId: actor.agencyId } AND { recipientUserId: actor.userId }.
 * Another user's notification id simply matches nothing (→ 404).
 */
export const notificationsRepo = defineScopedRepository<NotificationDoc>({
  model: NotificationModel,
  visibility: (actor) => ({ recipientUserId: new Types.ObjectId(actor.userId) }),
});

/** Mark every unread notification of the actor as read. */
export async function markAllReadFor(agencyId: string, userId: string, now = new Date()): Promise<number> {
  await connectDb();
  const r = await NotificationModel.updateMany(
    { agencyId: oid(agencyId), recipientUserId: oid(userId), readAt: null },
    { $set: { readAt: now } },
  );
  return r.modifiedCount;
}

export async function unreadCountFor(agencyId: string, userId: string): Promise<number> {
  await connectDb();
  return NotificationModel.countDocuments({ agencyId: oid(agencyId), recipientUserId: oid(userId), readAt: null });
}

/**
 * Idempotent bulk insert: one upsert per (agency, recipient, eventKey) with
 * $setOnInsert, so a retried event never creates a second row. Returns the
 * rows that were NEWLY created (only those get emails). Safe inside a
 * transaction (no duplicate-key errors on retry).
 */
export async function upsertNotifications(
  docs: Omit<NotificationDoc, "_id" | "createdAt" | "readAt">[],
): Promise<(Omit<NotificationDoc, "_id" | "createdAt" | "readAt"> & { _id: Types.ObjectId })[]> {
  if (docs.length === 0) return [];
  await connectDb();
  const res = await NotificationModel.bulkWrite(
    docs.map((d) => ({
      updateOne: {
        filter: { agencyId: d.agencyId, recipientUserId: d.recipientUserId, eventKey: d.eventKey },
        update: { $setOnInsert: { ...d, readAt: null } },
        upsert: true,
      },
    })),
    { ordered: true },
  );
  return Object.entries(res.upsertedIds).map(([i, id]) => ({ ...docs[Number(i)]!, _id: id as Types.ObjectId }));
}

/** Idempotent outbox enqueue (dedupeKey). */
export async function enqueueEmails(
  rows: Omit<EmailOutboxDoc, "_id" | "createdAt" | "updatedAt" | "status" | "attempts" | "lockedUntil" | "lastError" | "sentAt" | "providerId">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await connectDb();
  const res = await EmailOutboxModel.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { agencyId: r.agencyId, dedupeKey: r.dedupeKey },
        update: {
          $setOnInsert: { ...r, status: "PENDING", attempts: 0, lockedUntil: null, lastError: null, sentAt: null, providerId: null },
        },
        upsert: true,
      },
    })),
    { ordered: true },
  );
  return res.upsertedCount;
}

// ── Recipient resolution (always agency-scoped, ACTIVE only) ──────────────

export interface RecipientUser {
  id: string;
  role: SystemRole;
  email: string;
  name: string;
}

/** ACTIVE users of the agency among `ids`. Inactive / other-agency ids drop out. */
export async function activeUsers(agencyId: Types.ObjectId, ids: Types.ObjectId[]): Promise<RecipientUser[]> {
  if (ids.length === 0) return [];
  await connectDb();
  const rows = await UserModel.find(
    { agencyId, _id: { $in: ids }, status: UserStatus.ACTIVE },
    { role: 1, email: 1, name: 1 },
  ).lean();
  return rows.map((u) => ({ id: String(u._id), role: u.role as SystemRole, email: u.email, name: u.name }));
}

/** ACTIVE ADMIN / MANAGER users (agency-wide reviewers in the current role model). */
export async function activeOpsUserIds(agencyId: Types.ObjectId): Promise<Types.ObjectId[]> {
  await connectDb();
  const rows = await UserModel.find(
    { agencyId, role: { $in: [SystemRole.ADMIN, SystemRole.MANAGER] }, status: UserStatus.ACTIVE },
    { _id: 1 },
  ).lean();
  return rows.map((r) => r._id);
}

/** Users holding an ACTIVE membership on the brand (optionally only some roles). */
export async function activeBrandMemberIds(
  agencyId: Types.ObjectId,
  brandId: Types.ObjectId,
  roles?: BrandRole[],
): Promise<Set<string>> {
  await connectDb();
  const ids = await BrandMembershipModel.distinct("userId", {
    agencyId,
    brandId,
    status: MembershipStatus.ACTIVE,
    ...(roles ? { role: { $in: roles } } : {}),
  });
  return new Set(ids.map(String));
}

/** Assignees of the content's (non-cancelled) tasks of the given types — "production owners" by default. */
export async function taskAssigneeIds(
  agencyId: Types.ObjectId,
  contentId: Types.ObjectId,
  taskTypes: TaskType[] = VERSION_TASK_TYPES,
  openOnly = false,
): Promise<Types.ObjectId[]> {
  await connectDb();
  return ProductionTaskModel.distinct("assignedTo", {
    agencyId,
    contentId,
    taskType: { $in: taskTypes },
    status: openOnly ? { $in: ["TODO", "IN_PROGRESS", "BLOCKED"] } : { $ne: "CANCELLED" },
    assignedTo: { $ne: null },
  });
}

/** Who approved this exact version at the INTERNAL gate. */
export async function internalApproverIds(agencyId: Types.ObjectId, versionId: Types.ObjectId): Promise<Types.ObjectId[]> {
  await connectDb();
  return ApprovalModel.distinct("decidedBy", { agencyId, contentVersionId: versionId, stage: "INTERNAL", decision: "APPROVED" });
}

export async function clientIdsOfBrand(agencyId: Types.ObjectId, brandId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const ids = await activeBrandMemberIds(agencyId, brandId, [BrandRole.CLIENT]);
  return [...ids].map(oid);
}

export async function brandPrimaryUploader(agencyId: Types.ObjectId, brandId: Types.ObjectId): Promise<Types.ObjectId | null> {
  await connectDb();
  return (await BrandModel.findOne({ _id: brandId, agencyId }, { primaryUploaderId: 1 }).lean())?.primaryUploaderId ?? null;
}

export async function agencyName(agencyId: Types.ObjectId): Promise<string | null> {
  await connectDb();
  return (await AgencyModel.findById(agencyId, { name: 1 }).lean())?.name ?? null;
}

export async function brandInfo(agencyId: Types.ObjectId, brandId: Types.ObjectId) {
  await connectDb();
  const b = await BrandModel.findOne({ _id: brandId, agencyId }, { name: 1, status: 1 }).lean();
  return b ? { name: b.name, active: b.status === BrandStatus.ACTIVE } : null;
}

export async function preferencesFor(agencyId: Types.ObjectId, userIds: string[]) {
  await connectDb();
  const rows = await NotificationPreferenceModel.find({ agencyId, userId: { $in: userIds.map(oid) } }).lean();
  const map = new Map(rows.map((r) => [String(r.userId), { inAppEnabled: r.inAppEnabled, emailEnabled: r.emailEnabled }]));
  return (id: string) => map.get(id) ?? { inAppEnabled: true, emailEnabled: true };
}

export async function getPreference(agencyId: string, userId: string) {
  return (await preferencesFor(oid(agencyId), [userId]))(userId);
}

export async function savePreference(agencyId: string, userId: string, prefs: { inAppEnabled: boolean; emailEnabled: boolean }) {
  await connectDb();
  await NotificationPreferenceModel.updateOne(
    { agencyId: oid(agencyId), userId: oid(userId) },
    { $set: prefs, $setOnInsert: { agencyId: oid(agencyId), userId: oid(userId) } },
    { upsert: true },
  );
}

export async function reminderSettingsFor(agencyId: Types.ObjectId | string): Promise<ReminderSettings> {
  await connectDb();
  const doc = await AgencySettingsModel.findOne({ agencyId: oid(agencyId) }).lean();
  return { ...DEFAULT_REMINDER_SETTINGS, ...(doc?.reminders ?? {}) };
}

export async function saveReminderSettings(agencyId: string, reminders: ReminderSettings) {
  await connectDb();
  await AgencySettingsModel.updateOne(
    { agencyId: oid(agencyId) },
    { $set: { reminders }, $setOnInsert: { agencyId: oid(agencyId) } },
    { upsert: true, runValidators: true },
  );
}

// ── Outbox delivery ───────────────────────────────────────────────────────

const LEASE_MS = 2 * 60_000;

/** Atomically claim one due outbox row (PENDING and due, or a SENDING row whose lease expired). */
export async function claimDueEmail(now: Date): Promise<EmailOutboxDoc | null> {
  await connectDb();
  return EmailOutboxModel.findOneAndUpdate(
    {
      $or: [
        { status: "PENDING", nextAttemptAt: { $lte: now } },
        { status: "SENDING", lockedUntil: { $lt: now } },
      ],
    },
    { $set: { status: "SENDING", lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
  ).lean<EmailOutboxDoc>();
}

export async function finishEmail(id: Types.ObjectId, set: Partial<EmailOutboxDoc>) {
  await connectDb();
  await EmailOutboxModel.updateOne({ _id: id, status: "SENDING" }, { $set: { ...set, lockedUntil: null } });
}

export async function recipientStillReachable(agencyId: Types.ObjectId, userId: Types.ObjectId) {
  const [user] = await activeUsers(agencyId, [userId]);
  if (!user) return false;
  return (await preferencesFor(agencyId, [user.id]))(user.id).emailEnabled;
}

// ── Reminder scans (system job; every query is explicitly agency-scoped) ──

const SCAN_LIMIT = 500;

export async function agencyIds(): Promise<Types.ObjectId[]> {
  await connectDb();
  return (await AgencyModel.find({}, { _id: 1 }).lean()).map((a) => a._id);
}

/** Non-archived content that entered `status` at or before `before`, oldest first. */
export async function contentWaitingSince(agencyId: Types.ObjectId, status: ContentStatus, before: Date): Promise<ContentDoc[]> {
  await connectDb();
  return ContentModel.find({ agencyId, status, archivedAt: null, statusChangedAt: { $lte: before } })
    .sort({ statusChangedAt: 1 })
    .limit(SCAN_LIMIT)
    .lean<ContentDoc[]>();
}

/** Open, non-archived content whose due date passed before `before`. */
export async function overdueContent(agencyId: Types.ObjectId, before: Date): Promise<ContentDoc[]> {
  await connectDb();
  return ContentModel.find({
    agencyId,
    archivedAt: null,
    dueDate: { $ne: null, $lte: before },
    status: { $in: ["PLANNED", "IN_PRODUCTION", "INTERNAL_REVIEW", "CLIENT_REVIEW", "CHANGES_REQUESTED"] },
  })
    .sort({ dueDate: 1 })
    .limit(SCAN_LIMIT)
    .lean<ContentDoc[]>();
}

/** Open, assigned tasks past their due date. */
export async function overdueTasks(agencyId: Types.ObjectId, before: Date): Promise<ProductionTaskDoc[]> {
  await connectDb();
  return ProductionTaskModel.find({
    agencyId,
    status: { $in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
    assignedTo: { $ne: null },
    dueDate: { $ne: null, $lte: before },
  })
    .sort({ dueDate: 1 })
    .limit(SCAN_LIMIT)
    .lean<ProductionTaskDoc[]>();
}

/** Shoots still active after their end time. */
export async function overdueShoots(agencyId: Types.ObjectId, before: Date): Promise<ShootDoc[]> {
  await connectDb();
  return ShootModel.find({
    agencyId,
    status: { $in: ["SCHEDULED", "IN_PROGRESS", "PARTIALLY_COMPLETED"] },
    endAt: { $lte: before },
  })
    .sort({ endAt: 1 })
    .limit(SCAN_LIMIT)
    .lean<ShootDoc[]>();
}

export async function versionNumbers(agencyId: Types.ObjectId, ids: Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  await connectDb();
  const rows = await ContentVersionModel.find({ agencyId, _id: { $in: ids } }, { versionNumber: 1 }).lean();
  return new Map(rows.map((r) => [String(r._id), r.versionNumber]));
}

export async function contentTitles(agencyId: Types.ObjectId, ids: Types.ObjectId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  await connectDb();
  const rows = await ContentModel.find({ agencyId, _id: { $in: ids } }, { title: 1 }).lean();
  return new Map(rows.map((r) => [String(r._id), r.title]));
}

// -- Retention (notification + outbox rows only, never business records) --

export async function pruneNotifications(agencyId: Types.ObjectId, now: Date, readDays: number, criticalTypes: NotificationType[], unreadDays: number) {
  await connectDb();
  const day = 86_400_000;
  const read = await NotificationModel.deleteMany({ agencyId, readAt: { $ne: null }, createdAt: { $lt: new Date(now.getTime() - readDays * day) } });
  const unread = await NotificationModel.deleteMany({
    agencyId,
    readAt: null,
    type: { $nin: criticalTypes },
    createdAt: { $lt: new Date(now.getTime() - unreadDays * day) },
  });
  return { read: read.deletedCount, unread: unread.deletedCount };
}

export async function pruneOutbox(now: Date, days: number) {
  await connectDb();
  const r = await EmailOutboxModel.deleteMany({ status: { $in: ["SENT", "FAILED"] }, updatedAt: { $lt: new Date(now.getTime() - days * 86_400_000) } });
  return r.deletedCount;
}
