import "server-only";
import { Types } from "mongoose";
import { connectDb } from "@/server/db/connect";
import { BrandModel, type BrandDoc } from "@/server/db/models";
import { brandVisibility } from "./brand-visibility";
import { defineScopedRepository } from "./scoped-repository";

/** Brands visible to the actor (agency-wide for ADMIN/MANAGER, memberships otherwise). */
export const brandsRepo = defineScopedRepository<BrandDoc>({
  model: BrandModel,
  visibility: (actor) => brandVisibility<BrandDoc>(actor, undefined, "_id"),
});

export const brandNameKey = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "brand"
  );
}

export async function brandNameTaken(
  agencyId: string,
  nameKey: string,
  excludeBrandId?: string,
): Promise<boolean> {
  await connectDb();
  const filter: Record<string, unknown> = { agencyId: new Types.ObjectId(agencyId), nameKey };
  if (excludeBrandId) filter._id = { $ne: new Types.ObjectId(excludeBrandId) };
  return (await BrandModel.exists(filter)) !== null;
}

/** Picks the first free `base`, `base-2`, `base-3`… within the agency. */
async function nextFreeSlug(agencyId: Types.ObjectId, base: string): Promise<string> {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const taken = new Set(
    await BrandModel.distinct("slug", { agencyId, slug: { $regex: `^${escaped}(-\\d+)?$` } }),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export class DuplicateBrandNameError extends Error {}
export class DuplicateSlugError extends Error {}

/**
 * Insert with the next free agency-unique slug (single attempt — safe inside
 * a transaction). A concurrent create that wins the same slug surfaces as
 * DuplicateSlugError so the caller can retry with a fresh transaction; a
 * duplicate *name* surfaces as DuplicateBrandNameError.
 */
export async function insertBrand(
  data: Omit<BrandDoc, "_id" | "createdAt" | "updatedAt" | "slug" | "agencyId" | "createdBy"> & {
    agencyId: string;
    createdBy: string;
  },
): Promise<BrandDoc> {
  await connectDb();
  const agencyId = new Types.ObjectId(data.agencyId);
  const slug = await nextFreeSlug(agencyId, slugify(data.name));
  try {
    const [doc] = await BrandModel.create(
      [{ ...data, agencyId, createdBy: new Types.ObjectId(data.createdBy), slug }],
      { ordered: true },
    );
    return doc!.toObject();
  } catch (error) {
    const e = error as { code?: number; keyPattern?: Record<string, unknown> };
    if (e.code !== 11000) throw error;
    if (e.keyPattern && "nameKey" in e.keyPattern) throw new DuplicateBrandNameError();
    throw new DuplicateSlugError();
  }
}

/** id → minimal brand summary, for chips on other pages (one query, no N+1). */
export async function brandSummaries(
  agencyId: string,
  brandIds: Types.ObjectId[],
): Promise<Map<string, { id: string; name: string; status: BrandDoc["status"] }>> {
  if (brandIds.length === 0) return new Map();
  await connectDb();
  const rows = await BrandModel.find(
    { agencyId: new Types.ObjectId(agencyId), _id: { $in: brandIds } },
    { name: 1, status: 1 },
  )
    .lean()
    .exec();
  return new Map(
    rows.map((b) => [String(b._id), { id: String(b._id), name: b.name, status: b.status }]),
  );
}
