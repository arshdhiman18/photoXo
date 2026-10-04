import "server-only";
import type { Types } from "mongoose";
import { UserStatus } from "@/lib/domain/roles";
import { connectDb } from "@/server/db/connect";
import { UserModel, type UserDoc } from "@/server/db/models";

/**
 * Pre-authentication identity operations (invitation flow). Callers must
 * have already validated a single-use token; these never take actor input.
 */
export async function findUserForInvitation(
  userId: Types.ObjectId,
): Promise<Pick<UserDoc, "_id" | "name" | "email" | "role" | "status"> | null> {
  await connectDb();
  return UserModel.findById(userId, { name: 1, email: 1, role: 1, status: 1 }).lean().exec();
}

/** INVITED → ACTIVE (conditional; returns false if the user is no longer invited). */
export async function activateInvitedUser(userId: Types.ObjectId, name: string): Promise<boolean> {
  await connectDb();
  const res = await UserModel.updateOne(
    { _id: userId, status: UserStatus.INVITED },
    { $set: { status: UserStatus.ACTIVE, name, emailVerified: true, activatedAt: new Date() } },
  );
  return res.modifiedCount === 1;
}
