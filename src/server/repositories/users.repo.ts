import "server-only";
import { Types } from "mongoose";
import { canViewTeamDirectory } from "@/server/authz/permissions";
import { connectDb } from "@/server/db/connect";
import { UserModel, type UserDoc } from "@/server/db/models";
import { defineScopedRepository } from "./scoped-repository";

/**
 * Visibility for user records:
 * - ADMIN / MANAGER: everyone in their agency (managers read-only — writes
 *   are additionally gated by canManageUsers in the service).
 * - STAFF / CLIENT: only themselves. (Stage 2 will add a restricted
 *   co-worker projection for people sharing a brand/shoot.)
 */
export const usersRepo = defineScopedRepository<UserDoc>({
  model: UserModel,
  visibility: (actor) =>
    canViewTeamDirectory(actor) ? {} : { _id: new Types.ObjectId(actor.userId) },
});

/**
 * Global (cross-agency) email existence check — returns only a boolean.
 * Emails are globally unique identities.
 */
export async function emailIsTaken(email: string): Promise<boolean> {
  await connectDb();
  return (await UserModel.exists({ email: email.toLowerCase().trim() })) !== null;
}

export type NewUser = Omit<
  UserDoc,
  "_id" | "createdAt" | "updatedAt" | "agencyId" | "invitedBy"
> & {
  agencyId: string;
  invitedBy: string | null;
};

/** System-context insert for invitations and the admin bootstrap. */
export async function insertUser(data: NewUser): Promise<UserDoc> {
  await connectDb();
  const doc = await UserModel.create({
    ...data,
    agencyId: new Types.ObjectId(data.agencyId),
    invitedBy: data.invitedBy ? new Types.ObjectId(data.invitedBy) : null,
  });
  return doc.toObject();
}

/** Status distribution for the team page header (agency-scoped). */
export async function countUsersByStatus(agencyId: string): Promise<Record<string, number>> {
  await connectDb();
  const rows = await UserModel.aggregate<{ _id: string; n: number }>([
    { $match: { agencyId: new Types.ObjectId(agencyId) } },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}
