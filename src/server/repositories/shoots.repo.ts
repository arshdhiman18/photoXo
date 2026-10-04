import "server-only";
import { Types } from "mongoose";
import { ContentStatus } from "@/lib/domain/content";
import { ACTIVE_SHOOT_STATUSES, CrewStatus, ShootStatus } from "@/lib/domain/shoots";
import { SystemRole } from "@/lib/domain/roles";
import type { Actor } from "@/server/authz/actor";
import { connectDb } from "@/server/db/connect";
import {
  ContentModel,
  ProductionTaskModel,
  ShootModel,
  type ProductionTaskDoc,
  type ShootDoc,
} from "@/server/db/models";
import { brandVisibility, hasAgencyWideBrandAccess } from "./brand-visibility";
import { defineScopedRepository, NONE } from "./scoped-repository";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

/**
 * Shoot visibility:
 *  · ADMIN / MANAGER → all shoots in the agency
 *  · STAFF  → only shoots they are (non-removed) crew on, AND only while they
 *             still hold an active membership on the shoot's brand. Belonging
 *             to the brand alone grants nothing.
 *  · CLIENT → nothing (no client shoot data at all)
 */
export const shootRepo = defineScopedRepository<ShootDoc>({
  model: ShootModel,
  visibility: async (actor) => {
    if (hasAgencyWideBrandAccess(actor)) return {};
    if (actor.systemRole === SystemRole.CLIENT) return NONE;
    const brands = await brandVisibility<ShootDoc>(actor);
    if (brands === NONE) return NONE;
    return {
      $and: [
        brands,
        { crew: { $elemMatch: { userId: oid(actor.userId), status: { $ne: CrewStatus.CANCELLED } } } },
      ],
    };
  },
});

/** Scoped single-shoot lookup (404 outside the actor's scope). */
export const findShootForActor = (actor: Actor, shootId: string) => shootRepo.getById(actor, shootId);

export async function insertShoot(data: Omit<ShootDoc, "_id" | "createdAt" | "updatedAt">): Promise<ShootDoc> {
  await connectDb();
  const [doc] = await ShootModel.create([data]);
  return doc!.toObject();
}

// ── Conflicts ──────────────────────────────────────────────────────────────

export interface RawConflict {
  userId: string;
  shoot: Pick<ShootDoc, "_id" | "title" | "brandId" | "date" | "startTime" | "endTime" | "location">;
}

/**
 * Crew double-booking: any non-cancelled shoot in the agency (other than
 * `excludeShootId`) whose time range overlaps [startAt, endAt) and where the
 * same person is non-removed crew. Agency-scoped; called after authorisation.
 */
export async function findCrewConflicts(
  agencyId: string,
  userIds: string[],
  startAt: Date,
  endAt: Date,
  excludeShootId?: string,
): Promise<RawConflict[]> {
  if (userIds.length === 0) return [];
  await connectDb();
  const ids = userIds.map(oid);
  const filter: Record<string, unknown> = {
    agencyId: oid(agencyId),
    status: { $in: ACTIVE_SHOOT_STATUSES },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
    crew: { $elemMatch: { userId: { $in: ids }, status: { $ne: CrewStatus.CANCELLED } } },
  };
  if (excludeShootId) filter._id = { $ne: oid(excludeShootId) };
  const shoots = await ShootModel.find(filter, {
    title: 1,
    brandId: 1,
    date: 1,
    startTime: 1,
    endTime: 1,
    location: 1,
    crew: 1,
  }).lean<ShootDoc[]>();
  const wanted = new Set(userIds);
  return shoots.flatMap((s) =>
    s.crew
      .filter((c) => c.status !== CrewStatus.CANCELLED && wanted.has(String(c.userId)))
      .map((c) => ({ userId: String(c.userId), shoot: s })),
  );
}

/** All non-cancelled shoots overlapping a range, agency-wide (board conflict analysis). */
export async function shootsOverlappingRange(agencyId: string, startAt: Date, endAt: Date): Promise<ShootDoc[]> {
  await connectDb();
  return ShootModel.find(
    { agencyId: oid(agencyId), status: { $ne: ShootStatus.CANCELLED }, startAt: { $lt: endAt }, endAt: { $gt: startAt } },
    { startAt: 1, endAt: 1, crew: 1, title: 1, brandId: 1, date: 1, startTime: 1, endTime: 1, location: 1, status: 1 },
  ).lean<ShootDoc[]>();
}

// ── Content lock (at most one ACTIVE shoot per content) ───────────────────

/**
 * Attach content to a shoot: conditional on the content being free (or
 * already this shoot's). Returns how many were locked; callers inside a
 * transaction must abort when it is short.
 */
export async function lockContentForShoot(agencyId: string, contentIds: Types.ObjectId[], shootId: Types.ObjectId) {
  if (contentIds.length === 0) return 0;
  await connectDb();
  const res = await ContentModel.updateMany(
    { agencyId: oid(agencyId), _id: { $in: contentIds }, $or: [{ activeShootId: null }, { activeShootId: shootId }] },
    { $set: { activeShootId: shootId } },
  );
  return res.matchedCount;
}

export async function releaseContentFromShoot(agencyId: string, contentIds: Types.ObjectId[], shootId: Types.ObjectId) {
  if (contentIds.length === 0) return;
  await connectDb();
  await ContentModel.updateMany(
    { agencyId: oid(agencyId), _id: { $in: contentIds }, activeShootId: shootId },
    { $set: { activeShootId: null } },
  );
}

/** Content type/status/route for the shoot's content (one query). */
export async function contentForShoots(agencyId: string, contentIds: Types.ObjectId[]) {
  if (contentIds.length === 0) return [];
  await connectDb();
  return ContentModel.find(
    { agencyId: oid(agencyId), _id: { $in: contentIds } },
    { code: 1, title: 1, contentType: 1, status: 1, route: 1, referenceIds: 1, brandId: 1, dueDate: 1, agencyId: 1, archivedAt: 1 },
  ).lean();
}

// ── Task integration ───────────────────────────────────────────────────────

/** Route tasks currently waiting on the shoot for these contents. */
export async function tasksWaitingOnShoot(agencyId: string, contentIds: Types.ObjectId[]): Promise<ProductionTaskDoc[]> {
  if (contentIds.length === 0) return [];
  await connectDb();
  return ProductionTaskModel.find({
    agencyId: oid(agencyId),
    contentId: { $in: contentIds },
    waitingOn: "SHOOT",
    status: "BLOCKED",
  }).lean<ProductionTaskDoc[]>();
}

export async function unblockTasks(agencyId: string, taskIds: Types.ObjectId[]) {
  if (taskIds.length === 0) return;
  await connectDb();
  await ProductionTaskModel.updateMany(
    { agencyId: oid(agencyId), _id: { $in: taskIds }, waitingOn: "SHOOT", status: "BLOCKED" },
    { $set: { status: "TODO", waitingOn: null } },
  );
}

/** Non-cancelled route tasks for contents (to detect missing next steps). */
export async function liveRouteTasks(agencyId: string, contentIds: Types.ObjectId[]) {
  if (contentIds.length === 0) return [];
  await connectDb();
  return ProductionTaskModel.find(
    { agencyId: oid(agencyId), contentId: { $in: contentIds }, source: "ROUTE", status: { $ne: "CANCELLED" } },
    { contentId: 1, routeStep: 1, sequence: 1 },
  ).lean<Pick<ProductionTaskDoc, "_id" | "contentId" | "routeStep" | "sequence">[]>();
}

export const PRODUCTION_CONTENT_STATUSES: ContentStatus[] = [
  ContentStatus.PLANNED,
  ContentStatus.IN_PRODUCTION,
  ContentStatus.CHANGES_REQUESTED,
];
