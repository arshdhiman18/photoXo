import "server-only";
import { Types, type PipelineStage } from "mongoose";
import { MembershipStatus } from "@/lib/domain/brands";
import {
  BrandRole,
  SystemRole,
  UserStatus,
  type BrandRole as BrandRoleT,
} from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import { BrandMembershipModel, type BrandMembershipDoc } from "@/server/db/models";
import { brandVisibility, hasAgencyWideBrandAccess } from "./brand-visibility";
import { NONE, defineScopedRepository } from "./scoped-repository";

const oid = (id: string | Types.ObjectId) => (typeof id === "string" ? new Types.ObjectId(id) : id);

/**
 * Membership visibility:
 *  · ADMIN / MANAGER → all memberships in the agency
 *  · STAFF           → ACTIVE internal memberships on brands they belong to
 *                      (the coworker view — never client memberships)
 *  · CLIENT          → only their own memberships
 */
export const membershipsRepo = defineScopedRepository<BrandMembershipDoc>({
  model: BrandMembershipModel,
  visibility: async (actor) => {
    if (hasAgencyWideBrandAccess(actor)) return {};
    if (actor.systemRole === SystemRole.CLIENT) return { userId: oid(actor.userId) };
    const brands = await brandVisibility<BrandMembershipDoc>(actor);
    if (brands === NONE) return NONE;
    return { $and: [brands, { status: MembershipStatus.ACTIVE, role: { $ne: BrandRole.CLIENT } }] };
  },
});

// ── Writes (callers must have authorised the actor for the brand) ──────────

export async function findMembership(
  agencyId: string,
  key: { brandId: string; userId: string; role: BrandRoleT },
): Promise<BrandMembershipDoc | null> {
  await connectDb();
  return BrandMembershipModel.findOne({
    agencyId: oid(agencyId),
    brandId: oid(key.brandId),
    userId: oid(key.userId),
    role: key.role,
  })
    .lean<BrandMembershipDoc>()
    .exec();
}

/**
 * Ensure an ACTIVE membership for (brand, user, role). Reactivates a previous
 * row rather than duplicating it. Returns what happened for auditing.
 */
export async function activateMembership(input: {
  agencyId: string;
  brandId: string;
  userId: string;
  role: BrandRoleT;
  actorId: string;
}): Promise<{ membership: BrandMembershipDoc; outcome: "created" | "reactivated" | "unchanged" }> {
  await connectDb();
  const key = {
    agencyId: oid(input.agencyId),
    brandId: oid(input.brandId),
    userId: oid(input.userId),
    role: input.role,
  };
  const existing = await BrandMembershipModel.findOne(key).lean<BrandMembershipDoc>().exec();
  if (existing?.status === MembershipStatus.ACTIVE) {
    return { membership: existing, outcome: "unchanged" };
  }
  const now = new Date();
  try {
    const doc = await BrandMembershipModel.findOneAndUpdate(
      key,
      {
        $set: {
          status: MembershipStatus.ACTIVE,
          activatedAt: now,
          deactivatedAt: null,
          deactivatedBy: null,
        },
        $setOnInsert: { addedBy: oid(input.actorId) },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    )
      .lean<BrandMembershipDoc>()
      .exec();
    return { membership: doc!, outcome: existing ? "reactivated" : "created" };
  } catch (error) {
    // Concurrent upsert of the same key → the other request won; read it back.
    if ((error as { code?: number }).code === 11000) {
      const doc = await BrandMembershipModel.findOne(key).lean<BrandMembershipDoc>().exec();
      return { membership: doc!, outcome: "unchanged" };
    }
    throw error;
  }
}

/** ACTIVE → INACTIVE (conditional). Returns the updated row or null if it wasn't active. */
export async function deactivateMembership(
  agencyId: string,
  membershipId: string,
  actorId: string,
): Promise<BrandMembershipDoc | null> {
  await connectDb();
  return BrandMembershipModel.findOneAndUpdate(
    { _id: oid(membershipId), agencyId: oid(agencyId), status: MembershipStatus.ACTIVE },
    {
      $set: {
        status: MembershipStatus.INACTIVE,
        deactivatedAt: new Date(),
        deactivatedBy: oid(actorId),
      },
    },
    { returnDocument: "after" },
  )
    .lean<BrandMembershipDoc>()
    .exec();
}

// ── Reads (projection-limited, single round trip) ──────────────────────────

export interface MemberRow {
  membershipId: Types.ObjectId;
  role: BrandRoleT;
  status: BrandMembershipDoc["status"];
  activatedAt: Date;
  deactivatedAt: Date | null;
  user: {
    _id: Types.ObjectId;
    name: string;
    email: string;
    image: string | null;
    status: UserStatus;
    role: SystemRole;
  };
}

/** Full team of a brand for administrators (memberships ⋈ users, one aggregate). */
export async function listBrandMembers(agencyId: string, brandId: string): Promise<MemberRow[]> {
  await connectDb();
  const pipeline: PipelineStage[] = [
    { $match: { agencyId: oid(agencyId), brandId: oid(brandId) } },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
        pipeline: [{ $project: { name: 1, email: 1, image: 1, status: 1, role: 1 } }],
      },
    },
    { $unwind: "$user" },
    { $sort: { "user.name": 1 } },
    {
      $project: {
        _id: 0,
        membershipId: "$_id",
        role: 1,
        status: 1,
        activatedAt: 1,
        deactivatedAt: 1,
        user: 1,
      },
    },
  ];
  return BrandMembershipModel.aggregate<MemberRow>(pipeline);
}

export interface CoworkerRow {
  userId: Types.ObjectId;
  name: string;
  image: string | null;
  roles: BrandRoleT[];
}

/**
 * Collaboration view: ACTIVE internal members of a brand whose accounts are
 * ACTIVE. Projects only name + avatar + brand roles — no email, status,
 * system role or anything else.
 */
export async function listCoworkers(agencyId: string, brandId: string): Promise<CoworkerRow[]> {
  await connectDb();
  return BrandMembershipModel.aggregate<CoworkerRow>([
    {
      $match: {
        agencyId: oid(agencyId),
        brandId: oid(brandId),
        status: MembershipStatus.ACTIVE,
        role: { $ne: BrandRole.CLIENT },
      },
    },
    { $group: { _id: "$userId", roles: { $addToSet: "$role" } } },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
        pipeline: [{ $match: { status: UserStatus.ACTIVE } }, { $project: { name: 1, image: 1 } }],
      },
    },
    { $unwind: "$user" },
    { $sort: { "user.name": 1 } },
    { $project: { _id: 0, userId: "$_id", name: "$user.name", image: "$user.image", roles: 1 } },
  ]);
}

/** Active memberships for many users at once (Team page brand chips). */
export async function activeMembershipsForUsers(
  agencyId: string,
  userIds: Types.ObjectId[],
): Promise<{ userId: Types.ObjectId; brandId: Types.ObjectId; role: BrandRoleT }[]> {
  if (userIds.length === 0) return [];
  await connectDb();
  return BrandMembershipModel.find(
    { agencyId: oid(agencyId), userId: { $in: userIds }, status: MembershipStatus.ACTIVE },
    { userId: 1, brandId: 1, role: 1, _id: 0 },
  )
    .lean<{ userId: Types.ObjectId; brandId: Types.ObjectId; role: BrandRoleT }[]>()
    .exec();
}

/** brandId → number of distinct active internal members / clients (brand list). */
export async function memberCountsByBrand(
  agencyId: string,
  brandIds: Types.ObjectId[],
): Promise<Map<string, { team: number; clients: number }>> {
  if (brandIds.length === 0) return new Map();
  await connectDb();
  const rows = await BrandMembershipModel.aggregate<{
    _id: Types.ObjectId;
    team: number;
    clients: number;
  }>([
    {
      $match: {
        agencyId: oid(agencyId),
        brandId: { $in: brandIds },
        status: MembershipStatus.ACTIVE,
      },
    },
    {
      $group: {
        _id: "$brandId",
        team: {
          $addToSet: { $cond: [{ $ne: ["$role", BrandRole.CLIENT] }, "$userId", "$$REMOVE"] },
        },
        clients: {
          $addToSet: { $cond: [{ $eq: ["$role", BrandRole.CLIENT] }, "$userId", "$$REMOVE"] },
        },
      },
    },
    { $project: { team: { $size: "$team" }, clients: { $size: "$clients" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { team: r.team, clients: r.clients }]));
}

/** Active memberships a user holds that would be incompatible with a new system role. */
export async function activeRolesForUser(agencyId: string, userId: string): Promise<BrandRoleT[]> {
  await connectDb();
  return BrandMembershipModel.distinct("role", {
    agencyId: oid(agencyId),
    userId: oid(userId),
    status: MembershipStatus.ACTIVE,
  });
}
