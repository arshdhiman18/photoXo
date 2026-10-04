import "server-only";
import { isValidObjectId } from "mongoose";
import type { UserStatus } from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import { UserModel, type UserDoc } from "@/server/db/models";

/**
 * Unscoped identity lookups used ONLY by the authentication layer (before an
 * Actor exists). Returns minimal fields; never exposed to business code.
 */
export async function findUserStatusById(userId: string): Promise<UserStatus | null> {
  if (!isValidObjectId(userId)) return null;
  await connectDb();
  const user = await UserModel.findById(userId, { status: 1 }).lean().exec();
  return user?.status ?? null;
}

export async function findUserStatusByEmail(email: string): Promise<UserStatus | null> {
  await connectDb();
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() }, { status: 1 })
    .lean()
    .exec();
  return user?.status ?? null;
}

export type IdentityRecord = Pick<
  UserDoc,
  "_id" | "agencyId" | "name" | "email" | "image" | "role" | "status"
>;

export async function findIdentityById(userId: string): Promise<IdentityRecord | null> {
  if (!isValidObjectId(userId)) return null;
  await connectDb();
  return UserModel.findById(userId, {
    agencyId: 1,
    name: 1,
    email: 1,
    image: 1,
    role: 1,
    status: 1,
  })
    .lean<IdentityRecord>()
    .exec();
}
