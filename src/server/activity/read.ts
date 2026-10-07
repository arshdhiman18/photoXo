import "server-only";
import { Types } from "mongoose";
import type { ActivityEntityKind } from "@/lib/domain/activity";
import { connectDb } from "@/server/db/connect";
import { ActivityLogModel, UserModel, type ActivityLogDoc } from "@/server/db/models";

/**
 * Internal activity history for one entity. Callers must have authorised an
 * internal (admin/manager) viewer — never exposed to clients or staff.
 */
export async function listEntityActivity(
  agencyId: string,
  entity: { kind: ActivityEntityKind; id: string },
  limit = 50,
): Promise<(ActivityLogDoc & { actorName: string | null })[]> {
  await connectDb();
  const rows = await ActivityLogModel.find({
    agencyId: new Types.ObjectId(agencyId),
    "entity.kind": entity.kind,
    "entity.id": new Types.ObjectId(entity.id),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<ActivityLogDoc[]>();
  const ids = [...new Set(rows.map((r) => r.actorId).filter(Boolean).map(String))];
  const users = ids.length
    ? await UserModel.find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } }, { name: 1 }).lean()
    : [];
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  return rows.map((r) => ({ ...r, actorName: r.actorId ? (names.get(String(r.actorId)) ?? null) : null }));
}

/**
 * Everything that happened to one content item: events on the content itself
 * plus events on its tasks, versions, approvals and postings (meta.contentId).
 * Internal audit — callers must restrict this to ADMIN/MANAGER.
 */
export async function listContentActivity(
  agencyId: string,
  contentId: string,
  limit = 100,
): Promise<(ActivityLogDoc & { actorName: string | null })[]> {
  await connectDb();
  const id = new Types.ObjectId(contentId);
  const rows = await ActivityLogModel.find({
    agencyId: new Types.ObjectId(agencyId),
    $or: [{ "entity.kind": "CONTENT", "entity.id": id }, { "meta.contentId": contentId }],
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean<ActivityLogDoc[]>();
  const ids = [...new Set(rows.map((r) => r.actorId).filter(Boolean).map(String))];
  const users = ids.length
    ? await UserModel.find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } }, { name: 1 }).lean()
    : [];
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  return rows.map((r) => ({ ...r, actorName: r.actorId ? (names.get(String(r.actorId)) ?? null) : null }));
}
