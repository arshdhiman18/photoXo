import "server-only";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/authz/errors";
import { toSelfDTO, type SelfDTO } from "@/server/dto/users";
import { usersRepo } from "@/server/repositories/users.repo";

/**
 * Self-service account operations. The target is ALWAYS actor.userId — there
 * is no parameter through which another user could be addressed, and only
 * the display name is writable (role/status/agency/email are not).
 */
export async function getOwnAccount(actor: Actor): Promise<SelfDTO> {
  return toSelfDTO(await usersRepo.getById(actor, actor.userId));
}

export async function updateOwnProfile(actor: Actor, input: { name: string }): Promise<SelfDTO> {
  const updated = await usersRepo.updateById(actor, actor.userId, { $set: { name: input.name } });
  if (!updated) throw new NotFoundError();
  await recordActivity({
    actor,
    action: ActivityAction.USER_PROFILE_UPDATED,
    entity: { kind: ActivityEntityKind.USER, id: actor.userId },
    meta: { fields: ["name"] },
  });
  return toSelfDTO(updated);
}
