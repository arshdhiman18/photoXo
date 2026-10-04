import "server-only";
import { Types } from "mongoose";
import { connectDb } from "@/server/db/connect";
import { InvitationModel, type InvitationDoc } from "@/server/db/models";

/**
 * Invitations are addressed by token hash (pre-authentication) or by
 * (agencyId, userId) from services that have already authorised the actor.
 */
export async function createInvitation(data: {
  agencyId: string;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string | null;
}): Promise<void> {
  await connectDb();
  await InvitationModel.create({
    agencyId: new Types.ObjectId(data.agencyId),
    userId: new Types.ObjectId(data.userId),
    email: data.email,
    tokenHash: data.tokenHash,
    expiresAt: data.expiresAt,
    invitedBy: data.invitedBy ? new Types.ObjectId(data.invitedBy) : null,
  });
}

/** Revoke every outstanding invitation for a user (resend / revoke / deactivate). */
export async function revokeOpenInvitations(agencyId: string, userId: string): Promise<number> {
  await connectDb();
  const res = await InvitationModel.updateMany(
    {
      agencyId: new Types.ObjectId(agencyId),
      userId: new Types.ObjectId(userId),
      acceptedAt: null,
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );
  return res.modifiedCount;
}

export async function findInvitationByTokenHash(tokenHash: string): Promise<InvitationDoc | null> {
  await connectDb();
  return InvitationModel.findOne({ tokenHash }).lean<InvitationDoc>().exec();
}

/**
 * Atomically claim an invitation: succeeds for exactly one caller, only if
 * it is unused, unrevoked and unexpired. Prevents double use / races.
 */
export async function claimInvitation(tokenHash: string, now: Date): Promise<InvitationDoc | null> {
  await connectDb();
  return InvitationModel.findOneAndUpdate(
    { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { acceptedAt: now } },
    { returnDocument: "after" },
  )
    .lean<InvitationDoc>()
    .exec();
}

/** Compensation if activation fails after the claim. */
export async function releaseInvitationClaim(id: Types.ObjectId): Promise<void> {
  await connectDb();
  await InvitationModel.updateOne({ _id: id }, { $set: { acceptedAt: null } });
}

export async function latestInvitationsFor(
  agencyId: string,
  userIds: Types.ObjectId[],
): Promise<
  Map<string, Pick<InvitationDoc, "expiresAt" | "createdAt" | "acceptedAt" | "revokedAt">>
> {
  await connectDb();
  const rows = await InvitationModel.aggregate<{
    _id: Types.ObjectId;
    expiresAt: Date;
    createdAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }>([
    { $match: { agencyId: new Types.ObjectId(agencyId), userId: { $in: userIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$userId",
        expiresAt: { $first: "$expiresAt" },
        createdAt: { $first: "$createdAt" },
        acceptedAt: { $first: "$acceptedAt" },
        revokedAt: { $first: "$revokedAt" },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}
