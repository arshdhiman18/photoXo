import "server-only";
import { Types } from "mongoose";
import { MembershipStatus } from "@/lib/domain/brands";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import type { Actor } from "@/server/authz/actor";
import { connectDb } from "@/server/db/connect";
import { BrandMembershipModel } from "@/server/db/models";
import { NONE, type Visibility } from "./scoped-repository";

/**
 * Brand-level visibility — the rule every brand-owned repository (brands,
 * memberships, and later content, shoots, references, expenses…) applies.
 *
 *   ADMIN / MANAGER → every brand in their agency
 *   STAFF           → brands with an ACTIVE membership (any internal role)
 *   CLIENT          → brands with an ACTIVE *CLIENT* membership only
 *
 * Fail-closed: no memberships → nothing visible. Resolved fresh from the
 * database on every call (indexed), so deactivating a membership revokes
 * access on the very next request.
 */
export interface BrandAccessResolver {
  brandIdsFor(actor: Actor): Promise<string[]>;
}

export const membershipBrandAccess: BrandAccessResolver = {
  async brandIdsFor(actor) {
    await connectDb();
    const filter: Record<string, unknown> = {
      agencyId: new Types.ObjectId(actor.agencyId),
      userId: new Types.ObjectId(actor.userId),
      status: MembershipStatus.ACTIVE,
    };
    // A client's access derives only from CLIENT memberships; staff only from
    // internal roles (compatibility rules make other combinations impossible,
    // this is defence in depth).
    filter.role =
      actor.systemRole === SystemRole.CLIENT ? BrandRole.CLIENT : { $ne: BrandRole.CLIENT };
    const ids = await BrandMembershipModel.distinct("brandId", filter);
    return ids.map(String);
  },
};

export const hasAgencyWideBrandAccess = (actor: Pick<Actor, "systemRole">) =>
  actor.systemRole === SystemRole.ADMIN || actor.systemRole === SystemRole.MANAGER;

/**
 * Visibility filter for a collection whose brand reference lives in `field`
 * (`brandId` for brand-owned documents, `_id` for the brands collection).
 */
export async function brandVisibility<T>(
  actor: Actor,
  resolver: BrandAccessResolver = membershipBrandAccess,
  field: "brandId" | "_id" = "brandId",
): Promise<Visibility<T>> {
  if (hasAgencyWideBrandAccess(actor)) return {};
  const ids = await resolver.brandIdsFor(actor);
  if (ids.length === 0) return NONE;
  return { [field]: { $in: ids.map((id) => new Types.ObjectId(id)) } } as Visibility<T>;
}

/** Brands where the actor holds one of `roles` actively (e.g. BRAND_MANAGER). */
export async function brandIdsWithRoles(
  actor: Actor,
  roles: BrandRole[],
): Promise<Types.ObjectId[]> {
  await connectDb();
  return BrandMembershipModel.distinct("brandId", {
    agencyId: new Types.ObjectId(actor.agencyId),
    userId: new Types.ObjectId(actor.userId),
    status: MembershipStatus.ACTIVE,
    role: { $in: roles },
  });
}
