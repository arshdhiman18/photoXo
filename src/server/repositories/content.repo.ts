import "server-only";
import { Types } from "mongoose";
import {
  CLIENT_CHANGES_IN_PROGRESS_STATUSES,
  CLIENT_VISIBLE_STATUSES,
  ContentStatus,
  OPEN_TASK_STATUSES,
} from "@/lib/domain/content";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import type { Actor } from "@/server/authz/actor";
import { connectDb } from "@/server/db/connect";
import {
  AssetModel,
  BrandModel,
  ContentModel,
  ContentVersionModel,
  CounterModel,
  ProductionTaskModel,
  ReferenceModel,
  UserModel,
  type AssetDoc,
  type ContentDoc,
  type ContentVersionDoc,
  type ProductionTaskDoc,
  type ReferenceDoc,
} from "@/server/db/models";
import { brandIdsWithRoles, brandVisibility, hasAgencyWideBrandAccess } from "./brand-visibility";
import { defineScopedRepository, NONE, type Visibility } from "./scoped-repository";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

// ── Visibility ─────────────────────────────────────────────────────────────

/**
 * Content visibility (on top of agency scope):
 *  · ADMIN / MANAGER → all content in the agency
 *  · STAFF  → content of brands they actively belong to, EXCEPT other people's
 *             unaccepted ideas (PROPOSED/REJECTED), which only the creator and
 *             the brand's BRAND_MANAGERs see
 *  · CLIENT → content of their CLIENT brands in client-facing statuses only,
 *             plus items being revised after THEIR change request
 */
async function contentVisibility(actor: Actor): Promise<Visibility<ContentDoc>> {
  if (hasAgencyWideBrandAccess(actor)) return {};
  const brands = await brandVisibility<ContentDoc>(actor);
  if (brands === NONE) return NONE;

  if (actor.systemRole === SystemRole.CLIENT) {
    return {
      $and: [
        brands,
        {
          $or: [
            { status: { $in: CLIENT_VISIBLE_STATUSES } },
            {
              status: { $in: CLIENT_CHANGES_IN_PROGRESS_STATUSES },
              clientChangesPending: true,
            },
          ],
        },
      ],
    };
  }

  const managed = await brandIdsWithRoles(actor, [BrandRole.BRAND_MANAGER]);
  return {
    $and: [
      brands,
      {
        $or: [
          { status: { $nin: [ContentStatus.PROPOSED, ContentStatus.REJECTED] } },
          { createdBy: oid(actor.userId) },
          { brandId: { $in: managed } },
        ],
      },
    ],
  };
}

export const contentRepo = defineScopedRepository<ContentDoc>({
  model: ContentModel,
  visibility: contentVisibility,
});

/** Tasks: agency-wide for ops, brand-scoped for staff, never clients. */
export const tasksRepo = defineScopedRepository<ProductionTaskDoc>({
  model: ProductionTaskModel,
  visibility: async (actor) =>
    actor.systemRole === SystemRole.CLIENT ? NONE : brandVisibility<ProductionTaskDoc>(actor),
});

/** References are internal research: never visible to clients. */
export const referencesRepo = defineScopedRepository<ReferenceDoc>({
  model: ReferenceModel,
  visibility: async (actor) =>
    actor.systemRole === SystemRole.CLIENT ? NONE : brandVisibility<ReferenceDoc>(actor),
});

/** Versions: internal users only. Clients get internally-approved versions through the approval service (never this repo). */
export const versionsRepo = defineScopedRepository<ContentVersionDoc>({
  model: ContentVersionModel,
  visibility: async (actor) =>
    actor.systemRole === SystemRole.CLIENT ? NONE : brandVisibility<ContentVersionDoc>(actor),
});

// ── Codes ──────────────────────────────────────────────────────────────────

function prefixCandidates(name: string): string[] {
  const letters = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const base = (letters + "XXX").slice(0, 3);
  const consonants = letters.slice(1).replace(/[AEIOU]/g, "");
  const out = [base];
  if (letters[0] && consonants.length >= 2) out.push(letters[0] + consonants.slice(0, 2));
  for (let i = 2; i < 100; i++) out.push(`${base}${i}`);
  return out;
}

/** Brand code prefix, assigned once (unique per agency). Call inside a transaction. */
async function ensureCodePrefix(agencyId: string, brandId: string): Promise<string> {
  const brand = await BrandModel.findOne(
    { _id: oid(brandId), agencyId: oid(agencyId) },
    { name: 1, codePrefix: 1 },
  ).lean();
  if (!brand) throw new Error("brand not found");
  if (brand.codePrefix) return brand.codePrefix;
  const taken = new Set<string>(
    await BrandModel.distinct("codePrefix", {
      agencyId: oid(agencyId),
      codePrefix: { $type: "string" },
    }),
  );
  const prefix = prefixCandidates(brand.name).find((p) => !taken.has(p));
  if (!prefix) throw new Error("no free code prefix");
  await BrandModel.updateOne(
    { _id: brand._id, codePrefix: null },
    { $set: { codePrefix: prefix } },
  );
  return prefix;
}

/** Next human code for a brand, e.g. MAM-0142. Atomic; call inside a transaction. */
export async function allocateContentCode(agencyId: string, brandId: string): Promise<string> {
  await connectDb();
  const prefix = await ensureCodePrefix(agencyId, brandId);
  const counter = await CounterModel.findOneAndUpdate(
    { _id: `${agencyId}:${brandId}:content` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return `${prefix}-${String(counter!.seq).padStart(4, "0")}`;
}

// ── Inserts (callers authorise first; agency/brand/creator come from the actor + loaded docs) ──

export async function insertContent(
  data: Omit<ContentDoc, "_id" | "createdAt" | "updatedAt">,
): Promise<ContentDoc> {
  await connectDb();
  const [doc] = await ContentModel.create([data]);
  return doc!.toObject();
}

export async function insertTasks(
  tasks: Omit<ProductionTaskDoc, "_id" | "createdAt" | "updatedAt">[],
): Promise<ProductionTaskDoc[]> {
  if (tasks.length === 0) return [];
  await connectDb();
  const docs = await ProductionTaskModel.create(tasks, { ordered: true });
  return docs.map((d) => d.toObject());
}

export async function insertReference(
  data: Omit<ReferenceDoc, "_id" | "createdAt" | "updatedAt">,
): Promise<ReferenceDoc> {
  await connectDb();
  const [doc] = await ReferenceModel.create([data]);
  return doc!.toObject();
}

export async function insertAssets(
  assets: Omit<AssetDoc, "_id" | "createdAt" | "updatedAt">[],
): Promise<AssetDoc[]> {
  await connectDb();
  const docs = await AssetModel.create(assets, { ordered: true });
  return docs.map((d) => d.toObject());
}

/**
 * Atomically reserve the next version number for a content item. The unique
 * {agencyId, contentId, versionNumber} index is the final guarantee.
 */
export async function reserveVersionNumber(agencyId: string, contentId: string): Promise<number> {
  await connectDb();
  const doc = await ContentModel.findOneAndUpdate(
    { _id: oid(contentId), agencyId: oid(agencyId) },
    { $inc: { versionCount: 1 } },
    { returnDocument: "after", projection: { versionCount: 1 } },
  ).lean();
  if (!doc) throw new Error("content not found");
  return doc.versionCount;
}

export async function insertVersion(
  data: Omit<ContentVersionDoc, "_id" | "createdAt">,
): Promise<ContentVersionDoc> {
  await connectDb();
  const [doc] = await ContentVersionModel.create([data]);
  return doc!.toObject();
}

/** Cancel open tasks of a content item (optionally only route-generated ones). */
export async function cancelOpenTasks(
  agencyId: string,
  contentId: string,
  opts: { routeOnly?: boolean } = {},
): Promise<number> {
  await connectDb();
  const filter: Record<string, unknown> = {
    agencyId: oid(agencyId),
    contentId: oid(contentId),
    status: { $in: OPEN_TASK_STATUSES },
  };
  if (opts.routeOnly) filter.source = "ROUTE";
  const res = await ProductionTaskModel.updateMany(filter, { $set: { status: "CANCELLED" } });
  return res.modifiedCount;
}

// ── Aggregate reads (single round trip, no N+1) ───────────────────────────

export interface TaskSummary {
  total: number;
  done: number;
  open: number;
  unassigned: number;
}

/** contentId → task progress summary (cancelled tasks excluded). */
export async function taskSummaries(
  agencyId: string,
  contentIds: Types.ObjectId[],
): Promise<Map<string, TaskSummary>> {
  if (contentIds.length === 0) return new Map();
  await connectDb();
  const rows = await ProductionTaskModel.aggregate<{ _id: Types.ObjectId } & TaskSummary>([
    {
      $match: {
        agencyId: oid(agencyId),
        contentId: { $in: contentIds },
        status: { $ne: "CANCELLED" },
      },
    },
    {
      $group: {
        _id: "$contentId",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        open: { $sum: { $cond: [{ $in: ["$status", OPEN_TASK_STATUSES] }, 1, 0] } },
        unassigned: {
          $sum: {
            $cond: [
              { $and: [{ $in: ["$status", OPEN_TASK_STATUSES] }, { $eq: ["$assignedTo", null] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      String(r._id),
      { total: r.total, done: r.done, open: r.open, unassigned: r.unassigned },
    ]),
  );
}

/** Minimal person cards for ids (name + avatar). One query. Agency-scoped. */
export async function peopleByIds(
  agencyId: string,
  ids: (Types.ObjectId | null | undefined)[],
): Promise<Map<string, { id: string; name: string; image: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))].map((id) => oid(id));
  if (unique.length === 0) return new Map();
  await connectDb();
  const rows = await UserModel.find(
    { agencyId: oid(agencyId), _id: { $in: unique } },
    { name: 1, image: 1 },
  ).lean();
  return new Map(
    rows.map((u) => [String(u._id), { id: String(u._id), name: u.name, image: u.image ?? null }]),
  );
}

/** Assets for many versions at once. */
export async function assetsByIds(
  agencyId: string,
  ids: Types.ObjectId[],
): Promise<Map<string, AssetDoc>> {
  if (ids.length === 0) return new Map();
  await connectDb();
  const rows = await AssetModel.find({ agencyId: oid(agencyId), _id: { $in: ids } }).lean<
    AssetDoc[]
  >();
  return new Map(rows.map((a) => [String(a._id), a]));
}
