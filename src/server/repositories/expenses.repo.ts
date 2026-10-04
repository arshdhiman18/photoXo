import "server-only";
import { Types } from "mongoose";
import { SystemRole } from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import { AssetModel, ExpenseModel, ShootModel, type AssetDoc, type ExpenseDoc } from "@/server/db/models";
import { hasAgencyWideBrandAccess } from "./brand-visibility";
import { defineScopedRepository, NONE } from "./scoped-repository";

/**
 * Expenses:
 *  · ADMIN / MANAGER → every expense in the agency (approval role)
 *  · STAFF  → ONLY their own expenses (no one else's financial data)
 *  · CLIENT → nothing
 */
export const expensesRepo = defineScopedRepository<ExpenseDoc>({
  model: ExpenseModel,
  visibility: (actor) => {
    if (hasAgencyWideBrandAccess(actor)) return {};
    if (actor.systemRole === SystemRole.CLIENT) return NONE;
    return { userId: new Types.ObjectId(actor.userId) };
  },
});

export interface ExpenseTotals {
  count: number;
  totalMinor: number;
  byStatus: Record<string, { count: number; totalMinor: number }>;
}

/**
 * Sum of amounts by status for an already-scoped match (the service always
 * includes agencyId, and userId for non-ops viewers). Integer sums only.
 */
export async function expenseTotals(match: Record<string, unknown>): Promise<ExpenseTotals> {
  await connectDb();
  const rows = await ExpenseModel.aggregate<{ _id: string; count: number; total: number }>([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$amountMinor" } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((r) => [r._id, { count: r.count, totalMinor: r.total }]));
  return {
    count: rows.reduce((n, r) => n + r.count, 0),
    totalMinor: rows.reduce((n, r) => n + r.total, 0),
    byStatus,
  };
}

/** Insert a receipt asset (inside the expense transaction). */
export async function insertReceiptAsset(data: Omit<AssetDoc, "_id" | "createdAt" | "updatedAt">): Promise<AssetDoc> {
  await connectDb();
  const [doc] = await AssetModel.create([data]);
  return doc!.toObject();
}

/** An uploaded receipt the actor created and that isn't attached to another expense yet. */
export async function claimableReceipt(agencyId: string, userId: string, assetId: string, expenseId: Types.ObjectId | null) {
  if (!Types.ObjectId.isValid(assetId)) return null;
  await connectDb();
  return AssetModel.findOne({
    _id: new Types.ObjectId(assetId),
    agencyId: new Types.ObjectId(agencyId),
    kind: "RECEIPT",
    storage: "MEDIA",
    createdBy: new Types.ObjectId(userId),
    $or: [{ expenseId: null }, ...(expenseId ? [{ expenseId }] : [])],
  }).lean<AssetDoc>();
}

export async function attachReceipt(assetId: Types.ObjectId, expenseId: Types.ObjectId) {
  await connectDb();
  await AssetModel.updateOne({ _id: assetId, expenseId: null }, { $set: { expenseId } });
}

/** Title/date of shoots referenced by expenses the caller already may see. */
export async function shootSummaries(agencyId: string, ids: Types.ObjectId[]) {
  if (ids.length === 0) return new Map<string, { _id: Types.ObjectId; title: string; date: string }>();
  await connectDb();
  const rows = await ShootModel.find({ agencyId: new Types.ObjectId(agencyId), _id: { $in: ids } }, { title: 1, date: 1 }).lean();
  return new Map(rows.map((s) => [String(s._id), { _id: s._id, title: s.title, date: s.date }]));
}

export async function receiptAssets(agencyId: string, ids: Types.ObjectId[]): Promise<Map<string, AssetDoc>> {
  if (ids.length === 0) return new Map();
  await connectDb();
  const rows = await AssetModel.find({ agencyId: new Types.ObjectId(agencyId), _id: { $in: ids } }).lean<AssetDoc[]>();
  return new Map(rows.map((a) => [String(a._id), a]));
}
