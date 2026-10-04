import "server-only";
import { Types } from "mongoose";
import type { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import type { Actor } from "@/server/authz/actor";
import { connectDb } from "@/server/db/connect";
import { ActivityLogModel } from "@/server/db/models";

/**
 * Append an audit entry. `actor` null = system/CLI. agencyId and actorId
 * always come from the Actor (or explicit system context), never from input.
 * Awaited by callers: if the audit write fails, the operation reports failure.
 */
export async function recordActivity(entry: {
  actor: Actor | { system: true; agencyId: string };
  action: ActivityAction;
  entity: { kind: ActivityEntityKind; id: string };
  brandId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await connectDb();
  const isSystem = "system" in entry.actor;
  await ActivityLogModel.create({
    agencyId: new Types.ObjectId(entry.actor.agencyId),
    actorId: isSystem ? null : new Types.ObjectId((entry.actor as Actor).userId),
    action: entry.action,
    entity: { kind: entry.entity.kind, id: new Types.ObjectId(entry.entity.id) },
    brandId: entry.brandId ? new Types.ObjectId(entry.brandId) : null,
    meta: entry.meta ?? {},
  });
}
