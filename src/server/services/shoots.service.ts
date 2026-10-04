import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { BrandStatus, MembershipStatus } from "@/lib/domain/brands";
import {
  ContentStatus,
  PRODUCTION_ROUTE_DEFS,
  PRODUCTION_STATUSES,
  summarizeContentTypes,
  type ContentType,
} from "@/lib/domain/content";
import { SystemRole, UserStatus, type BrandRole as BrandRoleT } from "@/lib/domain/roles";
import {
  ACTIVE_SHOOT_STATUSES,
  CrewStatus,
  EDITABLE_SHOOT_STATUSES,
  SHOOT_CREW_ROLES,
  ShootStatus,
  crewNextAction,
  evaluateShootProgress,
  routeHasShoot,
  shootStepIndex,
} from "@/lib/domain/shoots";
import { addDays, todayInTimeZone, zonedDateTimeToUtc } from "@/lib/dates";
import type {
  addCrewSchema,
  BoardQuery,
  createShootSchema,
  rescheduleShootSchema,
  updateShootDetailsSchema,
} from "@/features/shoots/schemas";
import type {
  ConflictDTO,
  CrewMemberDTO,
  MyShootDTO,
  ShootAdminDTO,
  ShootContentDTO,
  ShootListItemDTO,
  ShootOptionsDTO,
  ShootStaffDTO,
} from "@/features/shoots/types";
import { recordActivity } from "@/server/activity/record";
import { listEntityActivity } from "@/server/activity/read";
import type { Actor } from "@/server/authz/actor";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { assertCan, canManageShoots } from "@/server/authz/permissions";
import type { BrandDoc, ContentDoc, CrewEntry, ShootDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { onCrewAssigned, onShootCancelled, onShootReady, onShootRescheduled } from "@/server/notifications/events";
import { toReferenceDTO } from "@/server/dto/content";
import { getOwnAgency } from "@/server/repositories/agency.repo";
import { brandSummaries, brandsRepo } from "@/server/repositories/brands.repo";
import {
  contentRepo,
  insertTasks,
  peopleByIds,
  referencesRepo,
} from "@/server/repositories/content.repo";
import { membershipsRepo } from "@/server/repositories/memberships.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import {
  contentForShoots,
  findCrewConflicts,
  findShootForActor,
  insertShoot,
  liveRouteTasks,
  lockContentForShoot,
  releaseContentFromShoot,
  shootRepo,
  shootsOverlappingRange,
  tasksWaitingOnShoot,
  unblockTasks,
} from "@/server/repositories/shoots.repo";
import { usersRepo } from "@/server/repositories/users.repo";
import { buildRouteTask, transitionContent } from "./content.service";

type CreateShoot = z.output<typeof createShootSchema>;
type Reschedule = z.output<typeof rescheduleShootSchema>;
type UpdateDetails = z.output<typeof updateShootDetailsSchema>;
type AddCrew = z.output<typeof addCrewSchema>;

/** Crew double-booking found and not overridden (details carry the conflicts for the UI). */
export class SchedulingConflictError extends AppError {
  constructor(public readonly conflicts: ConflictDTO[]) {
    super(
      "CONFLICT",
      "Some crew are already booked at that time. Review the overlaps, then override with a reason or change the plan.",
      undefined,
      { conflicts },
    );
  }
}

const auditShoot = (
  actor: Actor,
  action: ActivityAction,
  shoot: Pick<ShootDoc, "_id" | "brandId">,
  meta: Record<string, unknown> = {},
) =>
  recordActivity({
    actor,
    action,
    entity: { kind: ActivityEntityKind.SHOOT, id: String(shoot._id) },
    brandId: String(shoot.brandId),
    meta,
  });

const activeCrew = (s: Pick<ShootDoc, "crew">) => s.crew.filter((c) => c.status !== CrewStatus.CANCELLED);
const myEntry = (s: Pick<ShootDoc, "crew">, actor: Actor) =>
  s.crew.find((c) => String(c.userId) === actor.userId && c.status !== CrewStatus.CANCELLED) ?? null;

async function agencyTimezone(actor: Actor): Promise<string> {
  const agency = await getOwnAgency(actor);
  if (!agency) throw new NotFoundError();
  return agency.timezone;
}

/**
 * Optimistic save: bumps `revision` and requires the revision we read, so
 * concurrent edits (two managers, or crew completing at once) never clobber.
 */
async function saveShoot(
  actor: Actor,
  shoot: ShootDoc,
  update: Record<string, unknown>,
  arrayFilters?: Record<string, unknown>[],
): Promise<ShootDoc> {
  const updated = await shootRepo.updateById(
    actor,
    String(shoot._id),
    { ...update, $inc: { revision: 1 } },
    { revision: shoot.revision },
    arrayFilters ? { arrayFilters } : {},
  );
  if (!updated) throw new ConflictError("This shoot changed. Refresh and try again.");
  return updated;
}

// ── Validation ─────────────────────────────────────────────────────────────

async function loadActiveBrand(actor: Actor, brandId: string): Promise<BrandDoc> {
  const brand = await brandsRepo.getById(actor, brandId);
  if (brand.status !== BrandStatus.ACTIVE) throw new ConflictError("This brand is archived.");
  return brand;
}

/**
 * Content may join a shoot only if it is: in the shoot's brand & agency
 * (scoped lookup), not archived, in production statuses, on a route with a
 * SHOOT step, and not attached to another ACTIVE shoot.
 */
async function validateShootContent(
  actor: Actor,
  brandId: Types.ObjectId,
  ids: string[],
  currentShootId?: Types.ObjectId,
): Promise<ContentDoc[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await contentRepo.find(actor, { _id: { $in: unique.map(asObjectId) }, brandId }, { limit: 200 });
  if (found.length !== unique.length) {
    throw new ValidationError("Some content isn't available for this brand.", {
      contentIds: ["Only this brand's content can be added"],
    });
  }
  const problems: string[] = [];
  for (const c of found) {
    if (c.archivedAt) problems.push(`${c.code} is archived`);
    else if (!PRODUCTION_STATUSES.includes(c.status)) problems.push(`${c.code} is not in production (${c.status.toLowerCase()})`);
    else if (!routeHasShoot(c.route)) problems.push(`${c.code}'s route (${PRODUCTION_ROUTE_DEFS[c.route].label}) has no shoot`);
    else if (c.activeShootId && String(c.activeShootId) !== String(currentShootId ?? "")) {
      problems.push(`${c.code} is already on another active shoot`);
    }
  }
  if (problems.length) throw new ValidationError(problems.join(" · "), { contentIds: problems });
  // Preserve the order the user chose (shoot running order).
  const order = new Map(unique.map((id, i) => [id, i]));
  return found.sort((x, y) => (order.get(String(x._id)) ?? 0) - (order.get(String(y._id)) ?? 0));
}

/**
 * Crew eligibility (all server-side): same agency (scoped lookup), ACTIVE
 * internal account, ACTIVE membership on the shoot's brand in the given
 * role, and that role in SHOOT_CREW_ROLES. Clients can never be crew.
 */
async function validateCrewMember(actor: Actor, brandId: Types.ObjectId, userId: string, role: BrandRoleT) {
  const invalid = new ValidationError("This person can't be crew for this brand.", {
    crew: ["Not eligible as crew on this brand"],
  });
  if (!SHOOT_CREW_ROLES.includes(role)) throw invalid;
  const user = await usersRepo.findById(actor, userId);
  if (!user || user.status !== UserStatus.ACTIVE || user.role === SystemRole.CLIENT) throw invalid;
  const m = await membershipsRepo.find(
    actor,
    { brandId, userId: user._id, role, status: MembershipStatus.ACTIVE },
    { limit: 1 },
  );
  if (m.length === 0) throw invalid;
  return user;
}

/**
 * Detect double-booking for the given people in [startAt, endAt). Without an
 * override reason → SchedulingConflictError. With one (managers only — all
 * callers require canManageShoots) → returned so the override is audited.
 */
async function checkConflicts(
  actor: Actor,
  userIds: string[],
  range: { startAt: Date; endAt: Date },
  excludeShootId: string | undefined,
  overrideReason: string | undefined,
): Promise<ConflictDTO[]> {
  const raw = await findCrewConflicts(actor.agencyId, userIds, range.startAt, range.endAt, excludeShootId);
  if (raw.length === 0) return [];
  const [people, brands] = await Promise.all([
    peopleByIds(actor.agencyId, raw.map((r) => asObjectId(r.userId))),
    brandSummaries(actor.agencyId, raw.map((r) => r.shoot.brandId)),
  ]);
  const conflicts = raw.map((r) => ({
    userId: r.userId,
    userName: people.get(r.userId)?.name ?? "Someone",
    shootId: String(r.shoot._id),
    shootTitle: r.shoot.title,
    brandName: brands.get(String(r.shoot.brandId))?.name ?? "—",
    date: r.shoot.date,
    startTime: r.shoot.startTime,
    endTime: r.shoot.endTime,
    locationName: r.shoot.location.name,
  }));
  if (!overrideReason) throw new SchedulingConflictError(conflicts);
  return conflicts;
}

async function auditOverrides(actor: Actor, shoot: Pick<ShootDoc, "_id" | "brandId">, conflicts: ConflictDTO[], reason?: string) {
  for (const c of conflicts) {
    await auditShoot(actor, ActivityAction.SHOOT_CONFLICT_OVERRIDE, shoot, {
      userId: c.userId,
      conflictingShootId: c.shootId,
      reason,
    });
  }
}

function newCrewEntry(actor: Actor, userId: Types.ObjectId, role: BrandRoleT, required: boolean): Omit<CrewEntry, "_id"> {
  return {
    userId,
    brandRole: role,
    status: CrewStatus.ASSIGNED,
    required,
    assignedAt: new Date(),
    assignedBy: asObjectId(actor.userId),
    startedAt: null,
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    notes: null,
  };
}

async function loadManagedShoot(actor: Actor, shootId: string, editable = true): Promise<ShootDoc> {
  assertCan(canManageShoots(actor));
  const shoot = await findShootForActor(actor, shootId);
  if (editable && !EDITABLE_SHOOT_STATUSES.includes(shoot.status)) {
    throw new ConflictError("Completed or cancelled shoots can't be changed.");
  }
  return shoot;
}

// ── Lifecycle core (centralised) ───────────────────────────────────────────

/**
 * Shoot completion fulfils the SHOOT route step for every linked content:
 * tasks waiting on the shoot are unblocked; a missing next route task is
 * created from the central route config. Content status is NOT changed
 * (never approved/posted/completed by a shoot). Runs inside the caller's
 * transaction.
 */
async function onShootCompleted(actor: Actor, shoot: ShootDoc) {
  const contents = await contentForShoots(actor.agencyId, shoot.contentIds);
  await releaseContentFromShoot(actor.agencyId, shoot.contentIds, shoot._id);

  const waiting = await tasksWaitingOnShoot(actor.agencyId, shoot.contentIds);
  await unblockTasks(actor.agencyId, waiting.map((t) => t._id));
  for (const t of waiting) {
    await recordActivity({
      actor,
      action: ActivityAction.TASK_STATUS_CHANGED,
      entity: { kind: ActivityEntityKind.PRODUCTION_TASK, id: String(t._id) },
      brandId: String(t.brandId),
      meta: { contentId: String(t.contentId), from: "BLOCKED", to: "TODO", reason: "shoot_completed", shootId: String(shoot._id) },
    });
  }

  await onShootReady(actor, shoot._id, waiting, new Map(contents.map((c) => [String(c._id), c.title])));

  const live = await liveRouteTasks(actor.agencyId, shoot.contentIds);
  for (const c of contents) {
    if (c.status === ContentStatus.CANCELLED || c.archivedAt || !routeHasShoot(c.route)) continue;
    const next = PRODUCTION_ROUTE_DEFS[c.route].steps
      .map((s, index) => ({ ...s, index }))
      .find((s) => s.kind === "TASK" && s.index > shootStepIndex(c.route));
    if (!next || next.kind !== "TASK") continue;
    const mine = live.filter((t) => String(t.contentId) === String(c._id));
    if (mine.some((t) => t.routeStep === next.index)) continue;
    const seq = Math.max(0, ...mine.map((t) => t.sequence)) + 10;
    const [task] = await insertTasks([buildRouteTask(actor, c as ContentDoc, next, seq, { shootDone: true })]);
    await recordActivity({
      actor,
      action: ActivityAction.TASK_CREATED,
      entity: { kind: ActivityEntityKind.PRODUCTION_TASK, id: String(task!._id) },
      brandId: String(c.brandId),
      meta: { contentId: String(c._id), taskType: task!.taskType, source: "ROUTE", reason: "shoot_completed" },
    });
  }
}

/** Re-evaluate progress after a crew change; apply + audit the resulting shoot status. */
async function applyProgress(actor: Actor, shoot: ShootDoc): Promise<ShootDoc> {
  if (shoot.status !== ShootStatus.IN_PROGRESS && shoot.status !== ShootStatus.PARTIALLY_COMPLETED) return shoot;
  const next = evaluateShootProgress(shoot.crew);
  if (next === shoot.status) return shoot;
  const now = new Date();
  const set: Record<string, unknown> = { status: next };
  if (next === ShootStatus.PARTIALLY_COMPLETED && !shoot.partiallyCompletedAt) set.partiallyCompletedAt = now;
  if (next === ShootStatus.COMPLETED) set.completedAt = now;
  const updated = await saveShoot(actor, shoot, { $set: set });
  if (next === ShootStatus.PARTIALLY_COMPLETED) {
    await auditShoot(actor, ActivityAction.SHOOT_PARTIALLY_COMPLETED, shoot);
  } else if (next === ShootStatus.COMPLETED) {
    await auditShoot(actor, ActivityAction.SHOOT_COMPLETED, shoot, { contentCount: shoot.contentIds.length });
    await onShootCompleted(actor, updated);
  }
  return updated;
}

// ── Commands ───────────────────────────────────────────────────────────────

export async function createShoot(actor: Actor, input: CreateShoot): Promise<{ id: string }> {
  assertCan(canManageShoots(actor));
  const brand = await loadActiveBrand(actor, input.brandId);
  const tz = await agencyTimezone(actor);
  const range = {
    startAt: zonedDateTimeToUtc(input.date, input.startTime, tz),
    endAt: zonedDateTimeToUtc(input.date, input.endTime, tz),
  };
  const contents = await validateShootContent(actor, brand._id, input.contentIds);
  const userIds = input.crew.map((c) => c.userId);
  if (new Set(userIds).size !== userIds.length) {
    throw new ValidationError("Each person can be added to a shoot once.", { crew: ["Duplicate crew member"] });
  }
  for (const c of input.crew) await validateCrewMember(actor, brand._id, c.userId, c.brandRole as BrandRoleT);
  const conflicts = await checkConflicts(actor, userIds, range, undefined, input.overrideReason);

  return withTransaction(async () => {
    const shoot = await insertShoot({
      agencyId: brand.agencyId,
      brandId: brand._id,
      title: input.title,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      ...range,
      timezone: tz,
      location: { name: input.locationName, address: input.locationAddress },
      notes: input.notes,
      status: ShootStatus.SCHEDULED,
      contentIds: contents.map((c) => c._id),
      crew: input.crew.map((c) => newCrewEntry(actor, asObjectId(c.userId), c.brandRole as BrandRoleT, c.required)) as CrewEntry[],
      rescheduleHistory: [],
      revision: 0,
      startedAt: null,
      startedBy: null,
      partiallyCompletedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      archivedAt: null,
      createdBy: asObjectId(actor.userId),
    });
    const locked = await lockContentForShoot(actor.agencyId, shoot.contentIds, shoot._id);
    if (locked !== shoot.contentIds.length) throw new ConflictError("Some content was just added to another shoot. Refresh and try again.");
    await auditShoot(actor, ActivityAction.SHOOT_CREATED, shoot, {
      date: shoot.date,
      startTime: shoot.startTime,
      endTime: shoot.endTime,
      location: shoot.location.name,
      contentIds: shoot.contentIds.map(String),
    });
    for (const c of shoot.crew) {
      await auditShoot(actor, ActivityAction.SHOOT_CREW_ASSIGNED, shoot, { userId: String(c.userId), brandRole: c.brandRole });
    }
    await auditOverrides(actor, shoot, conflicts, input.overrideReason);
    await onCrewAssigned(actor, shoot, shoot.crew);
    return { id: String(shoot._id) };
  });
}

export async function updateShootDetails(actor: Actor, input: UpdateDetails): Promise<void> {
  const shoot = await loadManagedShoot(actor, input.shootId);
  const fields = (["title", "notes"] as const).filter((k) => (shoot[k] ?? null) !== (input[k] ?? null));
  if (fields.length === 0) return;
  await withTransaction(async () => {
    await saveShoot(actor, shoot, { $set: { title: input.title, notes: input.notes } });
    await auditShoot(actor, ActivityAction.SHOOT_UPDATED, shoot, { fields });
  });
}

/** Same shoot record; before/after captured in history + audit. Scheduled shoots only. */
export async function rescheduleShoot(actor: Actor, input: Reschedule): Promise<void> {
  const shoot = await loadManagedShoot(actor, input.shootId);
  if (shoot.status !== ShootStatus.SCHEDULED) throw new ConflictError("Only shoots that haven't started can be rescheduled.");
  const range = {
    startAt: zonedDateTimeToUtc(input.date, input.startTime, shoot.timezone),
    endAt: zonedDateTimeToUtc(input.date, input.endTime, shoot.timezone),
  };
  const conflicts = await checkConflicts(
    actor,
    activeCrew(shoot).map((c) => String(c.userId)),
    range,
    String(shoot._id),
    input.overrideReason,
  );
  const from = { date: shoot.date, startTime: shoot.startTime, endTime: shoot.endTime, location: shoot.location };
  const to = {
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    location: { name: input.locationName, address: input.locationAddress },
  };
  await withTransaction(async () => {
    await saveShoot(actor, shoot, {
      $set: { date: to.date, startTime: to.startTime, endTime: to.endTime, ...range, location: to.location },
      $push: { rescheduleHistory: { from, to, reason: input.reason, by: asObjectId(actor.userId), at: new Date() } },
    });
    await auditShoot(actor, ActivityAction.SHOOT_RESCHEDULED, shoot, { from, to, reason: input.reason });
    await auditOverrides(actor, shoot, conflicts, input.overrideReason);
    await onShootRescheduled(actor, { ...shoot, date: to.date, startTime: to.startTime, endTime: to.endTime }, shoot.rescheduleHistory.length + 1);
  });
}

export async function addShootContent(actor: Actor, shootId: string, contentId: string): Promise<void> {
  const shoot = await loadManagedShoot(actor, shootId);
  if (shoot.contentIds.some((id) => String(id) === contentId)) return;
  const [content] = await validateShootContent(actor, shoot.brandId, [contentId], shoot._id);
  await withTransaction(async () => {
    const updated = await saveShoot(actor, shoot, { $addToSet: { contentIds: content!._id } });
    if ((await lockContentForShoot(actor.agencyId, [content!._id], shoot._id)) !== 1) {
      throw new ConflictError("This content was just added to another shoot.");
    }
    await auditShoot(actor, ActivityAction.SHOOT_CONTENT_ADDED, shoot, { contentId, code: content!.code });
    if (updated.status !== ShootStatus.SCHEDULED && content!.status === ContentStatus.PLANNED) {
      await transitionContent(actor, content!, ContentStatus.IN_PRODUCTION, { reason: "shoot_started", automatic: true });
    }
  });
}

/** Removes the relationship only — the content itself is untouched. */
export async function removeShootContent(actor: Actor, shootId: string, contentId: string): Promise<void> {
  const shoot = await loadManagedShoot(actor, shootId);
  const id = shoot.contentIds.find((c) => String(c) === contentId);
  if (!id) throw new NotFoundError();
  await withTransaction(async () => {
    await saveShoot(actor, shoot, { $pull: { contentIds: id } });
    await releaseContentFromShoot(actor.agencyId, [id], shoot._id);
    await auditShoot(actor, ActivityAction.SHOOT_CONTENT_REMOVED, shoot, { contentId });
  });
}

export async function addCrew(actor: Actor, input: AddCrew): Promise<void> {
  const shoot = await loadManagedShoot(actor, input.shootId);
  if (myEntryFor(shoot, input.userId)) throw new ConflictError("This person is already on the crew.");
  await validateCrewMember(actor, shoot.brandId, input.userId, input.brandRole as BrandRoleT);
  const conflicts = await checkConflicts(actor, [input.userId], shoot, String(shoot._id), input.overrideReason);
  await withTransaction(async () => {
    const entry = newCrewEntry(actor, asObjectId(input.userId), input.brandRole as BrandRoleT, input.required) as CrewEntry;
    await saveShoot(actor, shoot, { $push: { crew: entry } });
    await auditShoot(actor, ActivityAction.SHOOT_CREW_ASSIGNED, shoot, { userId: input.userId, brandRole: input.brandRole });
    await auditOverrides(actor, shoot, conflicts, input.overrideReason);
    await onCrewAssigned(actor, shoot, [entry]);
  });
}

function myEntryFor(shoot: ShootDoc, userId: string) {
  return shoot.crew.find((c) => String(c.userId) === userId && c.status !== CrewStatus.CANCELLED) ?? null;
}

/** Marks the assignment CANCELLED (history kept). Completed work can't be removed. */
export async function removeCrew(actor: Actor, shootId: string, crewId: string): Promise<void> {
  const shoot = await loadManagedShoot(actor, shootId);
  const entry = shoot.crew.find((c) => String(c._id) === crewId);
  if (!entry || entry.status === CrewStatus.CANCELLED) throw new NotFoundError();
  if (entry.status === CrewStatus.COMPLETED) throw new ConflictError("This person already completed their part.");
  await withTransaction(async () => {
    const updated = await saveShoot(
      actor,
      shoot,
      { $set: { "crew.$[e].status": CrewStatus.CANCELLED, "crew.$[e].cancelledAt": new Date() } },
      [{ "e._id": entry._id }],
    );
    await auditShoot(actor, ActivityAction.SHOOT_CREW_REMOVED, shoot, {
      userId: String(entry.userId),
      brandRole: entry.brandRole,
    });
    // Removing the last incomplete required person can complete the shoot.
    await applyProgress(actor, updated);
  });
}

/**
 * Start: managers, or any non-removed crew member. SCHEDULED → IN_PROGRESS
 * (needs crew). A crew member joining an already-started shoot starts their
 * own part. Linked PLANNED content moves to IN_PRODUCTION.
 */
export async function startShoot(actor: Actor, shootId: string): Promise<void> {
  const shoot = await findShootForActor(actor, shootId); // staff: crew only → 404 otherwise
  const me = myEntry(shoot, actor);
  if (!me && !canManageShoots(actor)) throw new ForbiddenError("Only the crew or a manager can start this shoot.");
  if (shoot.status === ShootStatus.CANCELLED || shoot.status === ShootStatus.COMPLETED) {
    throw new ConflictError(`This shoot is ${shoot.status.toLowerCase()} and can't be started.`);
  }
  if (activeCrew(shoot).length === 0) throw new ConflictError("Add crew before starting the shoot.");

  await withTransaction(async () => {
    const now = new Date();
    const set: Record<string, unknown> = {};
    const startingShoot = shoot.status === ShootStatus.SCHEDULED;
    if (startingShoot) Object.assign(set, { status: ShootStatus.IN_PROGRESS, startedAt: now, startedBy: asObjectId(actor.userId) });
    const startingMe = me && me.status === CrewStatus.ASSIGNED;
    if (!startingShoot && !startingMe) return; // nothing to do (idempotent)

    const update: Record<string, unknown> = { $set: { ...set } };
    if (startingMe) {
      Object.assign(update.$set as object, { "crew.$[me].status": CrewStatus.IN_PROGRESS, "crew.$[me].startedAt": now });
    }
    const updated = await shootRepo.updateById(
      actor,
      shootId,
      { ...update, $inc: { revision: 1 } },
      { revision: shoot.revision },
      startingMe ? { arrayFilters: [{ "me._id": me!._id }] } : {},
    );
    if (!updated) throw new ConflictError("This shoot changed. Refresh and try again.");

    if (startingShoot) {
      await auditShoot(actor, ActivityAction.SHOOT_STARTED, shoot);
      const contents = await contentForShoots(actor.agencyId, shoot.contentIds);
      for (const c of contents) {
        if (c.status === ContentStatus.PLANNED) {
          await transitionContent(actor, c, ContentStatus.IN_PRODUCTION, { reason: "shoot_started", automatic: true });
        }
      }
    }
    if (startingMe) await auditShoot(actor, ActivityAction.SHOOT_CREW_STARTED, shoot, { userId: actor.userId });
  });
}

/** A crew member completes THEIR OWN part (no user id input exists). */
export async function completeMyPart(actor: Actor, shootId: string): Promise<void> {
  const shoot = await findShootForActor(actor, shootId);
  const me = myEntry(shoot, actor);
  if (!me) throw new ForbiddenError("You're not on this shoot's crew.");
  await completeCrewEntry(actor, shoot, me, { onBehalf: false });
}

/** Manager completes a crew member's part on their behalf (reason required, audited). */
export async function completeCrewOnBehalf(actor: Actor, shootId: string, crewId: string, reason: string): Promise<void> {
  assertCan(canManageShoots(actor));
  const shoot = await findShootForActor(actor, shootId);
  const entry = shoot.crew.find((c) => String(c._id) === crewId && c.status !== CrewStatus.CANCELLED);
  if (!entry) throw new NotFoundError();
  await completeCrewEntry(actor, shoot, entry, { onBehalf: true, reason });
}

async function completeCrewEntry(
  actor: Actor,
  shoot: ShootDoc,
  entry: CrewEntry,
  opts: { onBehalf: boolean; reason?: string },
) {
  if (shoot.status !== ShootStatus.IN_PROGRESS && shoot.status !== ShootStatus.PARTIALLY_COMPLETED) {
    throw new ConflictError("Start the shoot before marking work complete.");
  }
  if (entry.status === CrewStatus.COMPLETED) throw new ConflictError("Already marked complete.");
  await withTransaction(async () => {
    const now = new Date();
    const updated = await shootRepo.updateById(
      actor,
      String(shoot._id),
      {
        $set: {
          [`crew.$[e].status`]: CrewStatus.COMPLETED,
          [`crew.$[e].completedAt`]: now,
          [`crew.$[e].completedBy`]: asObjectId(actor.userId),
          ...(entry.startedAt ? {} : { [`crew.$[e].startedAt`]: now }),
        },
        $inc: { revision: 1 },
      },
      { revision: shoot.revision },
      { arrayFilters: [{ "e._id": entry._id }] },
    );
    if (!updated) throw new ConflictError("This shoot changed. Refresh and try again.");
    await auditShoot(actor, ActivityAction.SHOOT_CREW_COMPLETED, shoot, {
      userId: String(entry.userId),
      brandRole: entry.brandRole,
      onBehalf: opts.onBehalf,
      ...(opts.reason ? { reason: opts.reason } : {}),
    });
    await applyProgress(actor, updated);
  });
}

/** Cancel with a reason. Content, crew history and tasks are preserved; content is released. */
export async function cancelShoot(actor: Actor, shootId: string, reason: string): Promise<void> {
  const shoot = await loadManagedShoot(actor, shootId, false);
  if (!ACTIVE_SHOOT_STATUSES.includes(shoot.status)) throw new ConflictError("This shoot can't be cancelled.");
  await withTransaction(async () => {
    await saveShoot(actor, shoot, {
      $set: {
        status: ShootStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: asObjectId(actor.userId),
        cancellationReason: reason,
      },
    });
    await releaseContentFromShoot(actor.agencyId, shoot.contentIds, shoot._id);
    await auditShoot(actor, ActivityAction.SHOOT_CANCELLED, shoot, { reason, contentIds: shoot.contentIds.map(String) });
    await onShootCancelled(actor, shoot);
  });
}

// ── Queries ────────────────────────────────────────────────────────────────

/** Eligible content + crew candidates for a brand (create/edit form). */
export async function getShootOptions(actor: Actor, brandId: string, shootId?: string): Promise<ShootOptionsDTO> {
  assertCan(canManageShoots(actor));
  const brand = await loadActiveBrand(actor, brandId);
  const current = shootId ? await findShootForActor(actor, shootId) : null;
  if (current && String(current.brandId) !== brandId) throw new NotFoundError();

  const contents = await contentRepo.find(
    actor,
    {
      brandId: brand._id,
      archivedAt: null,
      status: { $in: PRODUCTION_STATUSES },
      $or: [{ activeShootId: null }, ...(current ? [{ activeShootId: current._id }] : [])],
    },
    { sort: { updatedAt: -1 }, limit: 200 },
  );
  const memberships = await membershipsRepo.find(
    actor,
    { brandId: brand._id, status: MembershipStatus.ACTIVE, role: { $in: SHOOT_CREW_ROLES } },
    { limit: 200, projection: { userId: 1, role: 1 } },
  );
  const roles = new Map<string, BrandRoleT[]>();
  for (const m of memberships) roles.set(String(m.userId), [...(roles.get(String(m.userId)) ?? []), m.role]);
  const users = await usersRepo.find(
    actor,
    { _id: { $in: [...roles.keys()].map(asObjectId) }, status: UserStatus.ACTIVE, role: { $ne: SystemRole.CLIENT } },
    { sort: { name: 1 }, limit: 200, projection: { name: 1, image: 1 } },
  );
  return {
    content: contents
      .filter((c) => routeHasShoot(c.route))
      .map((c) => ({ ...toShootContentDTO(c), attached: Boolean(current?.contentIds.some((id) => String(id) === String(c._id))) })),
    crew: users.map((u) => ({ userId: String(u._id), name: u.name, image: u.image ?? null, roles: roles.get(String(u._id)) ?? [] })),
  };
}

function toShootContentDTO(c: Pick<ContentDoc, "_id" | "code" | "title" | "contentType" | "status" | "route" | "referenceIds">): ShootContentDTO {
  return {
    id: String(c._id),
    code: c.code,
    title: c.title,
    contentType: c.contentType,
    status: c.status,
    route: c.route,
    hasReferences: (c.referenceIds?.length ?? 0) > 0,
  };
}

/**
 * Per-shoot conflicts from a set of overlapping shoots (in memory; one query
 * feeds the whole board). Only actionable overlaps are shown: both shoots must
 * still be active — a finished or cancelled shoot no longer double-books anyone.
 */
function conflictsFor(
  shoot: ShootDoc,
  pool: ShootDoc[],
  names: Map<string, { name: string }>,
  brandNames: Map<string, { name: string }>,
): ConflictDTO[] {
  if (!ACTIVE_SHOOT_STATUSES.includes(shoot.status)) return [];
  const mine = new Set(activeCrew(shoot).map((c) => String(c.userId)));
  const out: ConflictDTO[] = [];
  for (const o of pool) {
    if (String(o._id) === String(shoot._id) || !ACTIVE_SHOOT_STATUSES.includes(o.status)) continue;
    if (!(o.startAt < shoot.endAt && o.endAt > shoot.startAt)) continue;
    for (const c of activeCrew(o)) {
      if (!mine.has(String(c.userId))) continue;
      out.push({
        userId: String(c.userId),
        userName: names.get(String(c.userId))?.name ?? "Someone",
        shootId: String(o._id),
        shootTitle: o.title,
        brandName: brandNames.get(String(o.brandId))?.name ?? "—",
        date: o.date,
        startTime: o.startTime,
        endTime: o.endTime,
        locationName: o.location.name,
      });
    }
  }
  return out;
}

export interface BoardData {
  from: string;
  to: string;
  view: "day" | "week";
  today: string;
  items: ShootListItemDTO[];
}

/** Production board / shoot list (ADMIN/MANAGER). Batched: no per-shoot queries. */
export async function listShootsForAdmin(actor: Actor, q: BoardQuery & { from?: string; to?: string }): Promise<BoardData> {
  assertCan(canManageShoots(actor));
  const tz = await agencyTimezone(actor);
  const today = todayInTimeZone(tz);
  const view = q.view ?? "day";
  const from = q.from ?? q.date ?? today;
  const to = q.to ?? (view === "week" ? addDays(from, 6) : from);

  const filter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (q.brand) filter.brandId = asObjectId(q.brand);
  if (q.status) filter.status = q.status;
  if (q.crew) filter.crew = { $elemMatch: { userId: asObjectId(q.crew), status: { $ne: CrewStatus.CANCELLED } } };
  const shoots = await shootRepo.find(actor, filter, { sort: { startAt: 1 }, limit: 200 });

  const rangeStart = zonedDateTimeToUtc(from, "00:00", tz);
  const rangeEnd = zonedDateTimeToUtc(addDays(to, 1), "00:00", tz);
  const pool = await shootsOverlappingRange(actor.agencyId, rangeStart, rangeEnd);
  const allContentIds = shoots.flatMap((s) => s.contentIds);
  const [people, brands, contents] = await Promise.all([
    peopleByIds(actor.agencyId, [...shoots, ...pool].flatMap((s) => s.crew.map((c) => c.userId))),
    brandSummaries(actor.agencyId, [...shoots, ...pool].map((s) => s.brandId)),
    contentForShoots(actor.agencyId, allContentIds),
  ]);
  const typeOf = new Map(contents.map((c) => [String(c._id), c.contentType as ContentType]));

  let items = shoots.map((s) => ({
    id: String(s._id),
    title: s.title,
    brand: { id: String(s.brandId), name: brands.get(String(s.brandId))?.name ?? "—" },
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    location: s.location,
    status: s.status,
    contentCount: s.contentIds.length,
    contentSummary: summarizeContentTypes(s.contentIds.map((id) => typeOf.get(String(id))).filter(Boolean) as ContentType[]),
    crew: activeCrew(s).map((c) => ({
      id: String(c._id),
      userId: String(c.userId),
      name: people.get(String(c.userId))?.name ?? "—",
      image: people.get(String(c.userId))?.image ?? null,
      brandRole: c.brandRole,
      status: c.status,
    })),
    conflicts: conflictsFor(s, pool, people, brands),
  }));
  if (q.conflicts) items = items.filter((i) => i.conflicts.length > 0);
  return { from, to, view, today, items };
}

export async function getShootForAdmin(actor: Actor, shootId: string): Promise<ShootAdminDTO> {
  assertCan(canManageShoots(actor));
  const s = await findShootForActor(actor, shootId);
  const [brand, contents, pool, history] = await Promise.all([
    brandsRepo.getById(actor, String(s.brandId)),
    contentForShoots(actor.agencyId, s.contentIds),
    shootsOverlappingRange(actor.agencyId, s.startAt, s.endAt),
    listEntityActivity(actor.agencyId, { kind: ActivityEntityKind.SHOOT, id: shootId }),
  ]);
  const [people, brands] = await Promise.all([
    peopleByIds(actor.agencyId, [...s.crew, ...pool.flatMap((p) => p.crew)].map((c) => c.userId)),
    brandSummaries(actor.agencyId, pool.map((p) => p.brandId)),
  ]);
  const order = new Map(s.contentIds.map((id, i) => [String(id), i]));
  return {
    id: String(s._id),
    title: s.title,
    brand: { id: String(brand._id), name: brand.name },
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    timezone: s.timezone,
    location: s.location,
    notes: s.notes ?? null,
    status: s.status,
    contents: contents
      .sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0))
      .map((c) => toShootContentDTO(c)),
    crew: s.crew.map((c) => toCrewDTO(c, people, actor)),
    conflicts: conflictsFor(s, pool, people, brands),
    cancellationReason: s.cancellationReason ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    history: history.map((h) => ({
      id: String(h._id),
      action: h.action,
      label: HISTORY_LABEL[h.action] ?? h.action,
      actorName: h.actorName,
      at: h.createdAt.toISOString(),
      detail: historyDetail(h.meta, people),
    })),
  };
}

const HISTORY_LABEL: Record<string, string> = {
  "shoot.created": "Shoot scheduled",
  "shoot.updated": "Details edited",
  "shoot.rescheduled": "Rescheduled",
  "shoot.started": "Shoot started",
  "shoot.crew_assigned": "Crew assigned",
  "shoot.crew_removed": "Crew removed",
  "shoot.crew_started": "Crew started",
  "shoot.crew_completed": "Crew completed",
  "shoot.partially_completed": "Partially completed",
  "shoot.completed": "Shoot completed",
  "shoot.cancelled": "Shoot cancelled",
  "shoot.conflict_override": "Conflict overridden",
  "shoot.content_added": "Content added",
  "shoot.content_removed": "Content removed",
};

function historyDetail(meta: Record<string, unknown>, people: Map<string, { name: string }>): string | null {
  const who = typeof meta.userId === "string" ? people.get(meta.userId)?.name : null;
  const parts: string[] = [];
  if (who) parts.push(who);
  if (meta.onBehalf) parts.push("marked by a manager");
  const to = meta.to as { date?: string; startTime?: string; endTime?: string } | undefined;
  if (to?.date) parts.push(`→ ${to.date} ${to.startTime}–${to.endTime}`);
  if (typeof meta.reason === "string" && meta.reason) parts.push(`“${meta.reason}”`);
  return parts.length ? parts.join(" · ") : null;
}

function toCrewDTO(c: CrewEntry, people: Map<string, { name: string; image: string | null }>, actor: Actor): CrewMemberDTO {
  return {
    id: String(c._id),
    userId: String(c.userId),
    name: people.get(String(c.userId))?.name ?? "—",
    image: people.get(String(c.userId))?.image ?? null,
    brandRole: c.brandRole,
    status: c.status,
    required: c.required,
    completedAt: c.completedAt?.toISOString() ?? null,
    completedOnBehalf: Boolean(c.completedBy && String(c.completedBy) !== String(c.userId)),
    isMe: String(c.userId) === actor.userId,
  };
}

/** The actor's own shoots between two dates (crew assignments only — even for managers). */
export async function listMyShoots(actor: Actor, from: string, to: string = from): Promise<MyShootDTO[]> {
  const shoots = await shootRepo.find(
    actor,
    {
      date: { $gte: from, $lte: to },
      crew: { $elemMatch: { userId: asObjectId(actor.userId), status: { $ne: CrewStatus.CANCELLED } } },
    },
    { sort: { startAt: 1 }, limit: 100 },
  );
  if (shoots.length === 0) return [];
  const [brands, contents] = await Promise.all([
    brandsRepo.find(actor, { _id: { $in: [...new Set(shoots.map((s) => String(s.brandId)))].map(asObjectId) } }, {
      limit: 100,
      projection: { name: 1, logo: 1 },
    }),
    contentForShoots(actor.agencyId, shoots.flatMap((s) => s.contentIds)),
  ]);
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  const typeOf = new Map(contents.map((c) => [String(c._id), c.contentType as ContentType]));
  return shoots.map((s) => toMyShoot(s, actor, brandById.get(String(s.brandId)), typeOf));
}

function toMyShoot(
  s: ShootDoc,
  actor: Actor,
  brand: Pick<BrandDoc, "_id" | "name" | "logo"> | undefined,
  typeOf: Map<string, ContentType>,
): MyShootDTO {
  const me = myEntry(s, actor)!;
  return {
    id: String(s._id),
    title: s.title,
    brand: { id: String(s.brandId), name: brand?.name ?? "—", logoUrl: brand?.logo?.url ?? null },
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    location: s.location,
    status: s.status,
    myRole: me.brandRole,
    myStatus: me.status,
    contentCount: s.contentIds.length,
    contentSummary: summarizeContentTypes(s.contentIds.map((id) => typeOf.get(String(id))).filter(Boolean) as ContentType[]),
    nextAction: crewNextAction(s.status, me.status),
  };
}

/** Crew member's view of one shoot. Requires an active crew assignment (any role). */
export async function getShootForStaff(actor: Actor, shootId: string): Promise<ShootStaffDTO> {
  const s = await findShootForActor(actor, shootId);
  if (!myEntry(s, actor)) throw new NotFoundError();
  const contents = await contentForShoots(actor.agencyId, s.contentIds);
  const [brand, openable, refs, people] = await Promise.all([
    brandsRepo.getById(actor, String(s.brandId)),
    contentRepo.find(actor, { _id: { $in: s.contentIds } }, { limit: 200, projection: { _id: 1 } }),
    referencesRepo.find(actor, { _id: { $in: contents.flatMap((c) => c.referenceIds ?? []) } }, { limit: 100 }),
    peopleByIds(actor.agencyId, s.crew.map((c) => c.userId)),
  ]);
  const canOpen = new Set(openable.map((c) => String(c._id)));
  const typeOf = new Map(contents.map((c) => [String(c._id), c.contentType as ContentType]));
  const titleByRef = new Map<string, string>();
  for (const c of contents) for (const r of c.referenceIds ?? []) titleByRef.set(String(r), c.title);
  return {
    ...toMyShoot(s, actor, brand, typeOf),
    notes: s.notes ?? null,
    contents: contents.map((c) => ({ ...toShootContentDTO(c), canOpen: canOpen.has(String(c._id)) })),
    references: refs.map((r) => ({ ...toReferenceDTO(r, actor), contentTitle: titleByRef.get(String(r._id)) ?? "" })),
    crew: activeCrew(s).map((c) => {
      const d = toCrewDTO(c, people, actor);
      return { id: d.id, name: d.name, image: d.image, brandRole: d.brandRole, status: d.status, isMe: d.isMe };
    }),
  };
}

/** Shoots a content item has been on (visible to the actor). */
export async function shootsForContent(
  actor: Actor,
  contentId: string,
): Promise<{ id: string; title: string; date: string; startTime: string; endTime: string; status: ShootStatus; location: string }[]> {
  const rows = await shootRepo.find(actor, { contentIds: asObjectId(contentId) }, { sort: { startAt: -1 }, limit: 20 });
  return rows.map((s) => ({
    id: String(s._id),
    title: s.title,
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status,
    location: s.location.name,
  }));
}

