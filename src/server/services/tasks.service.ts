import "server-only";
import type { z } from "zod";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { MembershipStatus } from "@/lib/domain/brands";
import {
  ContentStatus,
  OPEN_TASK_STATUSES,
  PRODUCTION_STATUSES,
  TASK_TYPE_DEFS,
  type TaskStatus,
  type TaskType,
} from "@/lib/domain/content";
import { SystemRole, UserStatus } from "@/lib/domain/roles";
import type { createTaskSchema } from "@/features/content/schemas";
import type { AssigneeCandidateDTO, MyTaskDTO } from "@/features/content/types";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/authz/errors";
import { assertCan, canManageTasks } from "@/server/authz/permissions";
import type { ContentDoc, ProductionTaskDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { onRawFootageReady, onTaskAssigned } from "@/server/notifications/events";
import { allowedTaskStatuses } from "@/server/dto/content";
import { brandSummaries } from "@/server/repositories/brands.repo";
import { contentRepo, insertTasks, tasksRepo } from "@/server/repositories/content.repo";
import { membershipsRepo } from "@/server/repositories/memberships.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { usersRepo } from "@/server/repositories/users.repo";
import { getVisibleContent, transitionContent } from "./content.service";

type CreateTask = z.output<typeof createTaskSchema>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_ELIGIBLE = "This person can't be assigned this task on this brand.";

const auditTask = (
  actor: Actor,
  action: ActivityAction,
  t: Pick<ProductionTaskDoc, "_id" | "brandId" | "contentId">,
  meta: Record<string, unknown> = {},
) =>
  recordActivity({
    actor,
    action,
    entity: { kind: ActivityEntityKind.PRODUCTION_TASK, id: String(t._id) },
    brandId: String(t.brandId),
    meta: { contentId: String(t.contentId), ...meta },
  });

/**
 * Assignee eligibility, all server-side:
 *  · same agency (agency-scoped lookup — other agencies are invisible)
 *  · ACTIVE account, internal system role (STAFF / MANAGER) — never CLIENT
 *  · ACTIVE membership on the content's brand in a role that qualifies for
 *    the task type (central TASK_TYPE_DEFS)
 */
async function assertEligibleAssignee(
  actor: Actor,
  content: ContentDoc,
  userId: string,
  taskType: TaskType,
) {
  const user = await usersRepo.findById(actor, userId);
  if (!user || user.status !== UserStatus.ACTIVE)
    throw new ValidationError(NOT_ELIGIBLE, { assignedTo: [NOT_ELIGIBLE] });
  if (user.role !== SystemRole.STAFF && user.role !== SystemRole.MANAGER) {
    throw new ValidationError(NOT_ELIGIBLE, { assignedTo: [NOT_ELIGIBLE] });
  }
  const memberships = await membershipsRepo.find(
    actor,
    {
      brandId: content.brandId,
      userId: user._id,
      status: MembershipStatus.ACTIVE,
      role: { $in: TASK_TYPE_DEFS[taskType].eligibleBrandRoles },
    },
    { limit: 1 },
  );
  if (memberships.length === 0)
    throw new ValidationError(NOT_ELIGIBLE, { assignedTo: [NOT_ELIGIBLE] });
}

function assertProductionOpen(content: ContentDoc) {
  if (content.archivedAt || !PRODUCTION_STATUSES.includes(content.status)) {
    throw new ConflictError("Tasks can only change while the content is planned or in production.");
  }
}

/** PLANNED → IN_PRODUCTION once real work starts (task started or version added). */
export async function markInProductionIfPlanned(actor: Actor, content: ContentDoc, reason: string) {
  if (content.status === ContentStatus.PLANNED) {
    await transitionContent(actor, content, ContentStatus.IN_PRODUCTION, {
      reason,
      automatic: true,
    });
  }
}

export async function createTask(actor: Actor, input: CreateTask): Promise<{ id: string }> {
  assertCan(canManageTasks(actor));
  const content = await getVisibleContent(actor, input.contentId);
  assertProductionOpen(content);
  if (input.assignedTo)
    await assertEligibleAssignee(actor, content, input.assignedTo, input.taskType);

  const last = await tasksRepo.find(
    actor,
    { contentId: content._id },
    { sort: { sequence: -1 }, limit: 1 },
  );
  return withTransaction(async () => {
    const [task] = await insertTasks([
      {
        agencyId: content.agencyId,
        brandId: content.brandId,
        contentId: content._id,
        taskType: input.taskType,
        title: input.title ?? TASK_TYPE_DEFS[input.taskType].label,
        assignedTo: input.assignedTo ? asObjectId(input.assignedTo) : null,
        status: "TODO",
        source: "MANUAL",
        routeStep: null,
        waitingOn: null,
        sequence: (last[0]?.sequence ?? 0) + 10,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        startedAt: null,
        completedAt: null,
        createdBy: asObjectId(actor.userId),
      },
    ]);
    await auditTask(actor, ActivityAction.TASK_CREATED, task!, {
      taskType: task!.taskType,
      source: "MANUAL",
    });
    if (input.assignedTo)
      await auditTask(actor, ActivityAction.TASK_ASSIGNED, task!, {
        from: null,
        to: input.assignedTo,
      });
    return { id: String(task!._id) };
  });
}

export async function assignTask(
  actor: Actor,
  taskId: string,
  assignedTo: string | null,
): Promise<void> {
  assertCan(canManageTasks(actor));
  const task = await tasksRepo.getById(actor, taskId);
  if (!OPEN_TASK_STATUSES.includes(task.status))
    throw new ConflictError("Only open tasks can be reassigned.");
  const content = await getVisibleContent(actor, String(task.contentId));
  assertProductionOpen(content);
  const from = task.assignedTo ? String(task.assignedTo) : null;
  if (from === assignedTo) return;
  if (assignedTo) await assertEligibleAssignee(actor, content, assignedTo, task.taskType);

  await withTransaction(async () => {
    const updated = await tasksRepo.updateById(
      actor,
      taskId,
      { $set: { assignedTo: assignedTo ? asObjectId(assignedTo) : null } },
      { assignedTo: task.assignedTo, status: task.status },
    );
    if (!updated) throw new ConflictError("This task changed. Refresh and try again.");
    await auditTask(actor, ActivityAction.TASK_ASSIGNED, task, { from, to: assignedTo });
    if (assignedTo) await onTaskAssigned(actor, task, assignedTo, content.title);
  });
}

/**
 * Status change. Managers may set any status; an assignee may only move
 * their OWN task along ASSIGNEE_TASK_TRANSITIONS (no cancelling, no others').
 */
export async function updateTaskStatus(
  actor: Actor,
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const task = await tasksRepo.getById(actor, taskId); // clients: NONE → 404
  const content = await getVisibleContent(actor, String(task.contentId));
  if (task.status === status) return;
  const allowed = allowedTaskStatuses(actor, task, content.status);
  if (!allowed.includes(status)) {
    if (!canManageTasks(actor) && String(task.assignedTo) !== actor.userId) {
      throw new ForbiddenError("You can only update tasks assigned to you.");
    }
    throw new ConflictError("That status change isn't allowed for this task right now.");
  }
  const now = new Date();
  const set: Record<string, unknown> = { status };
  if (status === "IN_PROGRESS" && !task.startedAt) set.startedAt = now;
  set.completedAt = status === "COMPLETED" ? now : null;

  await withTransaction(async () => {
    const updated = await tasksRepo.updateById(
      actor,
      taskId,
      { $set: set },
      { status: task.status },
    );
    if (!updated) throw new ConflictError("This task changed. Refresh and try again.");
    await auditTask(actor, ActivityAction.TASK_STATUS_CHANGED, task, {
      from: task.status,
      to: status,
    });
    if (status === "IN_PROGRESS" || status === "COMPLETED") {
      await markInProductionIfPlanned(actor, content, "task_started");
    }
    if (status === "COMPLETED" && task.taskType === "UPLOAD_RAW") await onRawFootageReady(actor, task, content.title);
  });
}

/** Eligible people for a task type on this content's brand (server-side search, capped). */
export async function searchAssignees(
  actor: Actor,
  input: { contentId: string; taskType: TaskType; q: string },
): Promise<AssigneeCandidateDTO[]> {
  assertCan(canManageTasks(actor));
  const content = await getVisibleContent(actor, input.contentId);
  const memberships = await membershipsRepo.find(
    actor,
    {
      brandId: content.brandId,
      status: MembershipStatus.ACTIVE,
      role: { $in: TASK_TYPE_DEFS[input.taskType].eligibleBrandRoles },
    },
    { limit: 200, projection: { userId: 1, role: 1 } },
  );
  const roles = new Map<string, string[]>();
  for (const m of memberships)
    roles.set(String(m.userId), [...(roles.get(String(m.userId)) ?? []), m.role]);
  const filter: Record<string, unknown> = {
    _id: { $in: [...roles.keys()].map(asObjectId) },
    status: UserStatus.ACTIVE,
    role: { $in: [SystemRole.STAFF, SystemRole.MANAGER] },
  };
  if (input.q) filter.name = new RegExp(escapeRegex(input.q), "i");
  const users = await usersRepo.find(actor, filter, {
    sort: { name: 1 },
    limit: 20,
    projection: { name: 1, image: 1 },
  });
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    image: u.image ?? null,
    brandRoles: roles.get(String(u._id)) ?? [],
  }));
}

/** "My tasks": everything assigned to the actor (open first, recent completed). */
export async function listMyTasks(actor: Actor): Promise<MyTaskDTO[]> {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const tasks = await tasksRepo.find(
    actor,
    {
      assignedTo: asObjectId(actor.userId),
      $or: [
        { status: { $in: OPEN_TASK_STATUSES } },
        { status: "COMPLETED", completedAt: { $gte: since } },
      ],
    },
    { sort: { dueDate: 1, createdAt: 1 }, limit: 200 },
  );
  if (tasks.length === 0) return [];
  const contents = await contentRepo.find(
    actor,
    { _id: { $in: [...new Set(tasks.map((t) => String(t.contentId)))].map(asObjectId) } },
    {
      limit: 200,
      projection: { code: 1, title: 1, contentType: 1, status: 1, brandId: 1, archivedAt: 1 },
    },
  );
  const byId = new Map(contents.map((c) => [String(c._id), c]));
  const brands = await brandSummaries(
    actor.agencyId,
    [...new Set(contents.map((c) => String(c.brandId)))].map(asObjectId),
  );
  return tasks.flatMap((t) => {
    const c = byId.get(String(t.contentId));
    if (!c || c.archivedAt) return []; // content no longer visible (e.g. membership removed)
    return [
      {
        id: String(t._id),
        taskType: t.taskType,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate?.toISOString() ?? null,
        allowedStatuses: allowedTaskStatuses(actor, t, c.status),
        content: {
          id: String(c._id),
          code: c.code,
          title: c.title,
          contentType: c.contentType,
          status: c.status,
        },
        brand: {
          id: String(c.brandId),
          name: brands.get(String(c.brandId))?.name ?? "—",
          logoUrl: null,
        },
      },
    ];
  });
}
