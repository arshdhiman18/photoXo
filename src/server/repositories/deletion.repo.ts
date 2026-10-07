import "server-only";
import { Types } from "mongoose";
import { connectDb, getDb } from "@/server/db/connect";
import {
  ApprovalModel,
  AssetModel,
  BrandMembershipModel,
  BrandModel,
  ContentModel,
  ContentVersionModel,
  EmailOutboxModel,
  ExpenseModel,
  InvitationModel,
  NotificationModel,
  NotificationPreferenceModel,
  PostingModel,
  ProductionTaskModel,
  ReferenceModel,
  ShootModel,
  UploadIntentModel,
  UserModel,
} from "@/server/db/models";

/**
 * Permanent deletion of records created by mistake. Callers (services) must
 * authorize first and only purge when every blocker count is zero: anything
 * with review, posting, financial or shoot history is archived instead, so
 * append-only records (versions, approvals, postings, expenses) are never
 * orphaned. The activity log is kept on purpose.
 */

const oid = (id: string) => new Types.ObjectId(id);

/** Non-zero counts explain why something can't be deleted. */
export type Blockers = Record<string, number>;
export const hasBlockers = (b: Blockers) => Object.values(b).some((n) => n > 0);

async function dropNotifications(filter: Record<string, unknown>): Promise<void> {
  const ids = (await NotificationModel.find(filter, { _id: 1 }).lean()).map((n) => n._id);
  if (ids.length === 0) return;
  await EmailOutboxModel.deleteMany({ notificationId: { $in: ids } });
  await NotificationModel.deleteMany({ _id: { $in: ids } });
}

// ── Content ────────────────────────────────────────────────────────────────

export async function contentDeletionBlockers(agencyId: string, contentId: string): Promise<Blockers> {
  await connectDb();
  const q = { agencyId: oid(agencyId), contentId: oid(contentId) };
  const [versions, approvals, postings, shoots, files] = await Promise.all([
    ContentVersionModel.countDocuments(q),
    ApprovalModel.countDocuments(q),
    PostingModel.countDocuments(q),
    ShootModel.countDocuments({ agencyId: oid(agencyId), contentIds: oid(contentId) }),
    AssetModel.countDocuments(q),
  ]);
  return { versions, approvals, postings, shoots, files };
}

/** Call inside a transaction, after contentDeletionBlockers() returned none. */
export async function purgeContent(agencyId: string, contentId: string): Promise<boolean> {
  const q = { agencyId: oid(agencyId), contentId: oid(contentId) };
  await ProductionTaskModel.deleteMany(q);
  await UploadIntentModel.deleteMany(q);
  await dropNotifications(q);
  const res = await ContentModel.deleteOne({ _id: oid(contentId), agencyId: oid(agencyId) });
  return res.deletedCount === 1;
}

// ── Brand ──────────────────────────────────────────────────────────────────

export async function brandDeletionBlockers(agencyId: string, brandId: string): Promise<Blockers> {
  await connectDb();
  const q = { agencyId: oid(agencyId), brandId: oid(brandId) };
  const [content, shoots, expenses, files] = await Promise.all([
    ContentModel.countDocuments(q),
    ShootModel.countDocuments(q),
    ExpenseModel.countDocuments(q),
    AssetModel.countDocuments(q),
  ]);
  return { content, shoots, expenses, files };
}

/** Call inside a transaction, after brandDeletionBlockers() returned none. */
export async function purgeBrand(agencyId: string, brandId: string): Promise<boolean> {
  const q = { agencyId: oid(agencyId), brandId: oid(brandId) };
  await BrandMembershipModel.deleteMany(q);
  await ReferenceModel.deleteMany(q);
  await UploadIntentModel.deleteMany(q);
  await dropNotifications(q);
  const res = await BrandModel.deleteOne({ _id: oid(brandId), agencyId: oid(agencyId) });
  return res.deletedCount === 1;
}

// ── User (never-joined invitees only) ─────────────────────────────────────

export async function userDeletionBlockers(agencyId: string, userId: string): Promise<Blockers> {
  await connectDb();
  const a = oid(agencyId);
  const u = oid(userId);
  const [tasks, shoots, uploads, expenses] = await Promise.all([
    ProductionTaskModel.countDocuments({ agencyId: a, assignedTo: u }),
    ShootModel.countDocuments({ agencyId: a, "crew.userId": u }),
    ContentModel.countDocuments({ agencyId: a, uploaderOverrideId: u }),
    ExpenseModel.countDocuments({ agencyId: a, userId: u }),
  ]);
  return { tasks, shoots, uploads, expenses };
}

/** Call inside a transaction, after userDeletionBlockers() returned none. */
export async function purgeUser(agencyId: string, userId: string): Promise<boolean> {
  const q = { agencyId: oid(agencyId), userId: oid(userId) };
  await InvitationModel.deleteMany(q);
  await BrandMembershipModel.deleteMany(q);
  await NotificationPreferenceModel.deleteMany(q);
  await EmailOutboxModel.deleteMany({ agencyId: oid(agencyId), recipientUserId: oid(userId) });
  await NotificationModel.deleteMany({ agencyId: oid(agencyId), recipientUserId: oid(userId) });
  const res = await UserModel.deleteOne({ _id: oid(userId), agencyId: oid(agencyId) });
  return res.deletedCount === 1;
}

/** Better Auth's own collections (outside Mongoose). Never-joined users normally have none. */
export async function purgeAuthRecords(userId: string): Promise<void> {
  const db = getDb();
  const ids = [oid(userId), userId];
  await db.collection("sessions").deleteMany({ userId: { $in: ids } });
  await db.collection("accounts").deleteMany({ userId: { $in: ids } });
}
