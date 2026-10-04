import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import { ActivityAction, ActivityEntityKind, activityLabel } from "@/lib/domain/activity";
import { listContentActivity } from "@/server/activity/read";
import { BrandStatus, MembershipStatus } from "@/lib/domain/brands";
import {
  ARCHIVABLE_STATUSES,
  CONTENT_TYPES,
  ContentOrigin,
  ContentStatus,
  IdeaDecision,
  OPEN_TASK_STATUSES,
  PRODUCTION_ROUTE_DEFS,
  PRODUCTION_STATUSES,
  ROUTE_EDITABLE_STATUSES,
  canTransition,
  routeTaskSteps,
  VERSION_TASK_TYPES,
  type ContentType,
  type ProductionRoute,
  type TaskType,
} from "@/lib/domain/content";
import { shootStepIndex } from "@/lib/domain/shoots";
import type { PostingPlatform } from "@/lib/domain/postings";
import { BrandRole, UserStatus } from "@/lib/domain/roles";
import {
  CONTENT_PAGE_SIZE,
  type ContentListQuery,
  type changeRouteSchema,
  type createBriefSchema,
  type createIdeaSchema,
  type ideaDecisionSchema,
  type updateContentSchema,
} from "@/features/content/schemas";
import type {
  ContentAdminDTO,
  ContentClientDTO,
  ContentListData,
  ContentStaffDTO,
  ContentStaffListItemDTO,
  PersonRef,
} from "@/features/content/types";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/authz/errors";
import {
  assertCan,
  canManageContent,
  canProposeIdeas,
  canReviewIdeas,
} from "@/server/authz/permissions";
import type { BrandDoc, ContentDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { toContentClientDTO, toReferenceDTO, toTaskDTO, toVersionDTO } from "@/server/dto/content";
import { brandsRepo, brandSummaries } from "@/server/repositories/brands.repo";
import {
  allocateContentCode,
  assetsByIds,
  cancelOpenTasks,
  contentRepo,
  insertContent,
  insertTasks,
  peopleByIds,
  referencesRepo,
  taskSummaries,
  tasksRepo,
  versionsRepo,
} from "@/server/repositories/content.repo";
import { membershipsRepo } from "@/server/repositories/memberships.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { usersRepo } from "@/server/repositories/users.repo";
import { createReferenceInTx } from "./references.service";

type CreateBrief = z.output<typeof createBriefSchema>;
type CreateIdea = z.output<typeof createIdeaSchema>;
type UpdateContent = z.output<typeof updateContentSchema>;
type IdeaDecisionInput = z.output<typeof ideaDecisionSchema>;
type ChangeRoute = z.output<typeof changeRouteSchema>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const audit = (
  actor: Actor,
  action: ActivityAction,
  c: Pick<ContentDoc, "_id" | "brandId">,
  meta?: Record<string, unknown>,
) =>
  recordActivity({
    actor,
    action,
    entity: { kind: ActivityEntityKind.CONTENT, id: String(c._id) },
    brandId: String(c.brandId),
    meta,
  });

// ── Shared guards ──────────────────────────────────────────────────────────

/**
 * A brand the actor may create work for: visible to them (staff → active
 * internal membership; ops → any brand in the agency) and ACTIVE. Ids outside
 * scope are NOT_FOUND.
 */
async function loadWorkableBrand(actor: Actor, brandId: string): Promise<BrandDoc> {
  const brand = await brandsRepo.getById(actor, brandId);
  if (brand.status !== BrandStatus.ACTIVE) {
    throw new ConflictError("This brand is archived. Reactivate it to add content.");
  }
  return brand;
}

/** The single entry point for loading content by id (visibility-scoped → 404). */
export function getVisibleContent(actor: Actor, contentId: string): Promise<ContentDoc> {
  return contentRepo.getById(actor, contentId);
}

async function assertReferencesBelongToBrand(actor: Actor, brandId: Types.ObjectId, ids: string[]) {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const refs = await referencesRepo.find(
    actor,
    { _id: { $in: unique.map(asObjectId) }, brandId },
    { limit: 50 },
  );
  if (refs.length !== unique.length) {
    throw new ValidationError("Some references don't belong to this brand.", {
      referenceIds: ["Pick references from this brand"],
    });
  }
  return refs.map((r) => r._id);
}

/** Generate the route's TASK steps as unassigned TODO tasks (inside a transaction). */
/**
 * Build a route task for step `index` of the content's route. Steps that come
 * after the route's SHOOT step wait for the shoot (BLOCKED + waitingOn SHOOT)
 * unless `shootDone`. Route definitions are read from the central config.
 */
export function buildRouteTask(
  actor: Actor,
  content: Pick<ContentDoc, "_id" | "agencyId" | "brandId" | "route" | "dueDate">,
  step: { taskType: TaskType; label: string; index: number },
  sequence: number,
  opts: { shootDone?: boolean } = {},
) {
  const waits = !opts.shootDone && shootStepIndex(content.route) !== -1 && step.index > shootStepIndex(content.route);
  return {
    agencyId: content.agencyId,
    brandId: content.brandId,
    contentId: content._id,
    taskType: step.taskType,
    title: step.label,
    assignedTo: null,
    status: (waits ? "BLOCKED" : "TODO") as "BLOCKED" | "TODO",
    source: "ROUTE" as const,
    routeStep: step.index,
    waitingOn: waits ? ("SHOOT" as const) : null,
    sequence,
    dueDate: content.dueDate,
    startedAt: null,
    completedAt: null,
    createdBy: asObjectId(actor.userId),
  };
}

async function generateRouteTasks(actor: Actor, content: ContentDoc) {
  const steps = routeTaskSteps(content.route);
  const tasks = await insertTasks(steps.map((s, i) => buildRouteTask(actor, content, s, (i + 1) * 10)));
  for (const t of tasks) {
    await recordActivity({
      actor,
      action: ActivityAction.TASK_CREATED,
      entity: { kind: ActivityEntityKind.PRODUCTION_TASK, id: String(t._id) },
      brandId: String(content.brandId),
      meta: { contentId: String(content._id), taskType: t.taskType, source: "ROUTE" },
    });
  }
  return tasks;
}

/** Conditional status transition + audit. Refuses transitions not implemented yet. */
export async function transitionContent(
  actor: Actor,
  content: Pick<ContentDoc, "_id" | "brandId" | "status">,
  to: ContentStatus,
  meta: Record<string, unknown> = {},
  extraSet: Record<string, unknown> = {},
): Promise<ContentDoc> {
  if (!canTransition(content.status, to)) {
    throw new ConflictError("That change isn't possible for this content right now.");
  }
  const updated = await contentRepo.updateById(
    actor,
    String(content._id),
    { $set: { status: to, statusChangedAt: new Date(), ...extraSet } },
    { status: content.status },
  );
  if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
  await audit(actor, ActivityAction.CONTENT_STATUS_CHANGED, content, {
    from: content.status,
    to,
    ...meta,
  });
  return updated;
}

// ── Create ─────────────────────────────────────────────────────────────────

async function createContent(
  actor: Actor,
  input: {
    brandId: string;
    title: string;
    description: string | null;
    notes: string | null;
    contentType: ContentType;
    origin: ContentOrigin;
    route: ProductionRoute;
    priority: ContentDoc["priority"];
    dueDate: Date | null;
    referenceIds: string[];
    referenceUrl: string | null;
    status: ContentStatus;
    targetPlatforms?: PostingPlatform[];
  },
): Promise<{ id: string; code: string }> {
  const brand = await loadWorkableBrand(actor, input.brandId);
  const existingRefs = await assertReferencesBelongToBrand(actor, brand._id, input.referenceIds);

  // Code allocation + content + references + tasks + audit commit together.
  // A code-prefix race aborts the transaction → retry around it.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTransaction(async () => {
        const refIds = [...existingRefs];
        if (input.referenceUrl) {
          const ref = await createReferenceInTx(actor, brand, {
            url: input.referenceUrl,
            title: null,
            notes: null,
          });
          refIds.push(ref._id);
        }
        if (input.origin === ContentOrigin.REFERENCE && refIds.length === 0) {
          throw new ValidationError("Content created from a reference needs a reference.", {
            referenceUrl: ["Add the reference link"],
          });
        }
        const now = new Date();
        const content = await insertContent({
          agencyId: brand.agencyId,
          brandId: brand._id,
          code: await allocateContentCode(actor.agencyId, String(brand._id)),
          title: input.title,
          description: input.description,
          notes: input.notes,
          contentType: input.contentType,
          origin: input.origin,
          status: input.status,
          priority: input.priority,
          dueDate: input.dueDate,
          route: input.route,
          referenceIds: refIds,
          uploaderOverrideId: null,
          activeShootId: null,
          ideaReview: null,
          versionCount: 0,
          currentVersionId: null,
          reviewSubmission: null,
          internalApprovedVersionId: null,
          clientApprovedVersionId: null,
          changesRequestedBy: null,
          clientChangesPending: false,
          readyToPostAt: null,
          targetPlatforms: input.targetPlatforms ?? [],
          postedAt: null,
          completedAt: null,
          revisionCount: 0,
          revisions: [],
          statusChangedAt: now,
          cancelledAt: null,
          archivedAt: null,
          createdBy: asObjectId(actor.userId),
        });
        await audit(actor, ActivityAction.CONTENT_CREATED, content, {
          code: content.code,
          origin: content.origin,
          status: content.status,
          route: content.route,
        });
        if (content.status === ContentStatus.PLANNED) await generateRouteTasks(actor, content);
        return { id: String(content._id), code: content.code };
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000 && attempt < 2) continue;
      throw error;
    }
  }
  throw new ConflictError("Couldn't create the content right now. Please try again.");
}

/** Admin/manager brief → PLANNED with route tasks generated. */
export async function createBrief(actor: Actor, input: CreateBrief) {
  assertCan(canManageContent(actor));
  const contentType = input.contentType as ContentType;
  return createContent(actor, {
    ...input,
    contentType,
    route: input.route ?? CONTENT_TYPES[contentType].defaultRoute,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    status: ContentStatus.PLANNED,
  });
}

/**
 * Employee idea → PROPOSED (no tasks until a manager accepts it). The brand
 * must be one the actor actively works on (scope → 404 otherwise).
 */
export async function createIdea(actor: Actor, input: CreateIdea) {
  assertCan(canProposeIdeas(actor));
  const contentType = input.contentType as ContentType;
  return createContent(actor, {
    ...input,
    contentType,
    origin: ContentOrigin.TEAM_IDEA,
    route: CONTENT_TYPES[contentType].defaultRoute,
    dueDate: null,
    status: ContentStatus.PROPOSED,
  });
}

// ── Update ─────────────────────────────────────────────────────────────────

/** Can this actor edit this content's fields? Ops: yes. Creator: only their idea while PROPOSED. */
function editMode(actor: Actor, c: ContentDoc): "full" | "idea" | null {
  if (canManageContent(actor)) return "full";
  if (
    c.origin === ContentOrigin.TEAM_IDEA &&
    c.status === ContentStatus.PROPOSED &&
    String(c.createdBy) === actor.userId
  ) {
    return "idea";
  }
  return null;
}

export async function updateContent(actor: Actor, input: UpdateContent): Promise<void> {
  const before = await getVisibleContent(actor, input.contentId);
  const mode = editMode(actor, before);
  if (!mode) throw new ForbiddenError("You can't edit this content.");
  if (before.archivedAt) throw new ConflictError("Archived content can't be edited.");

  const refIds = await assertReferencesBelongToBrand(actor, before.brandId, input.referenceIds);
  const set: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    notes: input.notes,
    contentType: input.contentType,
    priority: input.priority,
    referenceIds: refIds,
  };
  if (mode === "full") set.dueDate = input.dueDate ? new Date(input.dueDate) : null;

  const changed = Object.keys(set).filter(
    (k) =>
      JSON.stringify((before as unknown as Record<string, unknown>)[k] ?? null) !==
      JSON.stringify(set[k] ?? null),
  );
  if (changed.length === 0) return;

  await withTransaction(async () => {
    const updated = await contentRepo.updateById(
      actor,
      input.contentId,
      { $set: set },
      { status: before.status },
    );
    if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
    await audit(actor, ActivityAction.CONTENT_UPDATED, before, { fields: changed });
  });
}

// ── Ideas ──────────────────────────────────────────────────────────────────

export async function decideIdea(actor: Actor, input: IdeaDecisionInput): Promise<void> {
  assertCan(canReviewIdeas(actor));
  const c = await getVisibleContent(actor, input.contentId);
  if (c.origin !== ContentOrigin.TEAM_IDEA || c.status !== ContentStatus.PROPOSED) {
    throw new ConflictError("Only proposed team ideas can be reviewed.");
  }
  const review = {
    decision: input.decision,
    note: input.note,
    decidedBy: asObjectId(actor.userId),
    decidedAt: new Date(),
  };

  await withTransaction(async () => {
    if (input.decision === IdeaDecision.ACCEPTED) {
      const updated = await transitionContent(
        actor,
        c,
        ContentStatus.PLANNED,
        { reason: "idea_accepted" },
        { ideaReview: review },
      );
      await audit(actor, ActivityAction.CONTENT_IDEA_ACCEPTED, c, { note: input.note });
      await generateRouteTasks(actor, updated);
    } else if (input.decision === IdeaDecision.REJECTED) {
      await transitionContent(
        actor,
        c,
        ContentStatus.REJECTED,
        { reason: "idea_rejected" },
        { ideaReview: review },
      );
      await audit(actor, ActivityAction.CONTENT_IDEA_REJECTED, c, { note: input.note });
    } else {
      // Stays PROPOSED; author edits and resubmits. Not the approval-gate CHANGES_REQUESTED.
      const updated = await contentRepo.updateById(
        actor,
        input.contentId,
        { $set: { ideaReview: review } },
        { status: ContentStatus.PROPOSED },
      );
      if (!updated) throw new ConflictError("This idea changed. Refresh and try again.");
      await audit(actor, ActivityAction.CONTENT_IDEA_CHANGES_REQUESTED, c, { note: input.note });
    }
  });
}

/** Author resubmits an idea after changes were requested. */
export async function resubmitIdea(actor: Actor, contentId: string): Promise<void> {
  const c = await getVisibleContent(actor, contentId);
  if (String(c.createdBy) !== actor.userId || c.status !== ContentStatus.PROPOSED) {
    throw new ForbiddenError("Only the author can resubmit this idea.");
  }
  if (c.ideaReview?.decision !== IdeaDecision.CHANGES_REQUESTED) {
    throw new ConflictError("This idea is already waiting for review.");
  }
  await withTransaction(async () => {
    const updated = await contentRepo.updateById(
      actor,
      contentId,
      { $set: { ideaReview: null } },
      { status: ContentStatus.PROPOSED, "ideaReview.decision": IdeaDecision.CHANGES_REQUESTED },
    );
    if (!updated) throw new ConflictError("This idea changed. Refresh and try again.");
    await audit(actor, ActivityAction.CONTENT_IDEA_RESUBMITTED, c);
  });
}

// ── Route, cancel, archive, uploader ───────────────────────────────────────

export async function changeRoute(actor: Actor, input: ChangeRoute): Promise<void> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, input.contentId);
  if (c.route === input.route) return;
  if (!ROUTE_EDITABLE_STATUSES.includes(c.status)) {
    throw new ConflictError("The route can only change before production starts.");
  }
  const started = await tasksRepo.count(actor, {
    contentId: c._id,
    source: "ROUTE",
    status: { $in: ["IN_PROGRESS", "COMPLETED"] },
  });
  if (started > 0)
    throw new ConflictError("Route tasks have already started; the route can't change.");

  await withTransaction(async () => {
    const updated = await contentRepo.updateById(
      actor,
      input.contentId,
      { $set: { route: input.route } },
      { status: c.status, route: c.route },
    );
    if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
    const cancelled = await cancelOpenTasks(actor.agencyId, input.contentId, { routeOnly: true });
    await audit(actor, ActivityAction.CONTENT_ROUTE_CHANGED, c, {
      from: c.route,
      to: input.route,
      cancelledRouteTasks: cancelled,
    });
    if (updated.status === ContentStatus.PLANNED) await generateRouteTasks(actor, updated);
  });
}

export async function cancelContent(
  actor: Actor,
  contentId: string,
  reason: string | null,
): Promise<void> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, contentId);
  await withTransaction(async () => {
    await transitionContent(
      actor,
      c,
      ContentStatus.CANCELLED,
      { reason },
      { cancelledAt: new Date() },
    );
    await cancelOpenTasks(actor.agencyId, contentId);
  });
}

export async function archiveContent(actor: Actor, contentId: string): Promise<void> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, contentId);
  if (c.archivedAt) return;
  if (!ARCHIVABLE_STATUSES.includes(c.status)) {
    throw new ConflictError("Only completed, rejected or cancelled content can be archived.");
  }
  await withTransaction(async () => {
    const updated = await contentRepo.updateById(
      actor,
      contentId,
      { $set: { archivedAt: new Date() } },
      { archivedAt: null },
    );
    if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
    await audit(actor, ActivityAction.CONTENT_ARCHIVED, c, { status: c.status });
  });
}

/** Is `userId` an ACTIVE account holding an ACTIVE UPLOADER membership on the brand? */
async function isActiveUploader(
  actor: Actor,
  brandId: Types.ObjectId,
  userId: string,
): Promise<boolean> {
  const [rows, user] = await Promise.all([
    membershipsRepo.find(
      actor,
      {
        brandId,
        userId: asObjectId(userId),
        role: BrandRole.UPLOADER,
        status: MembershipStatus.ACTIVE,
      },
      { limit: 1 },
    ),
    usersRepo.findById(actor, userId),
  ]);
  return rows.length > 0 && user?.status === UserStatus.ACTIVE;
}

/**
 * Per-content exception to the brand's primary uploader. Never touches the
 * brand; never rewritten automatically when brand assignments change.
 */
export async function setUploaderOverride(
  actor: Actor,
  contentId: string,
  userId: string | null,
): Promise<void> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, contentId);
  if (c.archivedAt) throw new ConflictError("Archived content can't be changed.");
  const from = c.uploaderOverrideId ? String(c.uploaderOverrideId) : null;
  if (from === userId) return;
  if (userId && !(await isActiveUploader(actor, c.brandId, userId))) {
    throw new ValidationError("Only an active Content Uploader on this brand can be chosen.", {
      userId: ["Not an active uploader on this brand"],
    });
  }
  await withTransaction(async () => {
    const updated = await contentRepo.updateById(
      actor,
      contentId,
      { $set: { uploaderOverrideId: userId ? asObjectId(userId) : null } },
      { uploaderOverrideId: c.uploaderOverrideId },
    );
    if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
    await audit(actor, ActivityAction.CONTENT_UPLOADER_OVERRIDE_CHANGED, c, { from, to: userId });
  });
}

/** Active uploaders on the content's brand (for the override picker). */
export async function listBrandUploaders(actor: Actor, contentId: string): Promise<PersonRef[]> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, contentId);
  const rows = await membershipsRepo.find(
    actor,
    { brandId: c.brandId, role: BrandRole.UPLOADER, status: MembershipStatus.ACTIVE },
    { limit: 100, projection: { userId: 1 } },
  );
  const users = await usersRepo.find(
    actor,
    { _id: { $in: rows.map((r) => r.userId) }, status: UserStatus.ACTIVE },
    { projection: { name: 1, image: 1 }, sort: { name: 1 }, limit: 100 },
  );
  return users.map((u) => ({ id: String(u._id), name: u.name, image: u.image ?? null }));
}

// ── Reads ──────────────────────────────────────────────────────────────────

async function loadBundle(actor: Actor, c: ContentDoc) {
  const [brand, refs, tasks, versions] = await Promise.all([
    brandsRepo.findById(actor, String(c.brandId)),
    c.referenceIds.length
      ? referencesRepo.find(actor, { _id: { $in: c.referenceIds } }, { limit: 50 })
      : Promise.resolve([]),
    tasksRepo.find(
      actor,
      { contentId: c._id },
      { sort: { sequence: 1, createdAt: 1 }, limit: 200 },
    ),
    versionsRepo.find(actor, { contentId: c._id }, { sort: { versionNumber: -1 }, limit: 200 }),
  ]);
  if (!brand) throw new NotFoundError();
  const [assets, people] = await Promise.all([
    assetsByIds(
      actor.agencyId,
      versions.flatMap((v) => v.assetIds),
    ),
    peopleByIds(actor.agencyId, [
      c.createdBy,
      c.ideaReview?.decidedBy,
      c.uploaderOverrideId,
      brand.primaryUploaderId,
      ...tasks.map((t) => t.assignedTo),
      ...versions.map((v) => v.createdBy),
    ]),
  ]);
  return { brand, refs, tasks, versions, assets, people };
}

export async function getContentForAdmin(
  actor: Actor,
  contentId: string,
): Promise<ContentAdminDTO> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, contentId);
  const { brand, refs, tasks, versions, assets, people } = await loadBundle(actor, c);
  const p = (id: unknown) => (id ? (people.get(String(id)) ?? null) : null);

  const override = p(c.uploaderOverrideId);
  const brandPrimary = p(brand.primaryUploaderId);
  const overrideInvalid = c.uploaderOverrideId
    ? !(await isActiveUploader(actor, c.brandId, String(c.uploaderOverrideId)))
    : false;

  return {
    id: String(c._id),
    code: c.code,
    title: c.title,
    description: c.description ?? null,
    notes: c.notes ?? null,
    brand: {
      id: String(brand._id),
      name: brand.name,
      logoUrl: brand.logo?.url ?? null,
      archived: brand.status === BrandStatus.ARCHIVED,
    },
    contentType: c.contentType,
    origin: c.origin,
    status: c.status,
    priority: c.priority,
    dueDate: c.dueDate?.toISOString() ?? null,
    route: c.route,
    references: refs.map((r) => toReferenceDTO(r, actor)),
    tasks: tasks.map((t) => toTaskDTO(t, actor, people, c.status)),
    versions: versions.map((v) => toVersionDTO(v, assets, people)),
    uploader: {
      effective: override ?? brandPrimary,
      source: override ? "OVERRIDE" : brandPrimary ? "BRAND_PRIMARY" : "NONE",
      brandPrimary,
      override,
      overrideInvalid,
    },
    ideaReview: c.ideaReview
      ? {
          decision: c.ideaReview.decision,
          note: c.ideaReview.note ?? null,
          decidedBy: p(c.ideaReview.decidedBy),
          decidedAt: c.ideaReview.decidedAt.toISOString(),
        }
      : null,
    createdBy: p(c.createdBy),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
}

export async function getContentForStaff(
  actor: Actor,
  contentId: string,
): Promise<ContentStaffDTO> {
  const c = await getVisibleContent(actor, contentId);
  const { brand, refs, tasks, versions, assets, people } = await loadBundle(actor, c);
  const mine = tasks.filter((t) => t.assignedTo && String(t.assignedTo) === actor.userId);
  return {
    id: String(c._id),
    code: c.code,
    title: c.title,
    description: c.description ?? null,
    notes: c.notes ?? null,
    brand: { id: String(brand._id), name: brand.name, logoUrl: brand.logo?.url ?? null },
    contentType: c.contentType,
    origin: c.origin,
    status: c.status,
    priority: c.priority,
    dueDate: c.dueDate?.toISOString() ?? null,
    route: c.route,
    references: refs.map((r) => toReferenceDTO(r, actor)),
    tasks: tasks
      .filter((t) => t.status !== "CANCELLED")
      .map((t) => toTaskDTO(t, actor, people, c.status)),
    versions: versions.map((v) => toVersionDTO(v, assets, people)),
    ideaReview: c.ideaReview
      ? { decision: c.ideaReview.decision, note: c.ideaReview.note ?? null }
      : null,
    createdByMe: String(c.createdBy) === actor.userId,
    canEditIdea: editMode(actor, c) === "idea",
    canAddVersion:
      PRODUCTION_STATUSES.includes(c.status) &&
      (canManageContent(actor) ||
        mine.some((t) => t.status !== "CANCELLED" && VERSION_TASK_TYPES.includes(t.taskType))),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function getContentForClient(
  actor: Actor,
  contentId: string,
): Promise<ContentClientDTO> {
  const c = await getVisibleContent(actor, contentId); // client scope: own brands + client statuses
  const brand = await brandsRepo.getById(actor, String(c.brandId));
  return toContentClientDTO(c, brand);
}

// ── Lists ──────────────────────────────────────────────────────────────────

export async function listContentAdmin(
  actor: Actor,
  query: ContentListQuery,
): Promise<ContentListData> {
  assertCan(canManageContent(actor));
  const filter: Record<string, unknown> = { archivedAt: query.archived ? { $ne: null } : null };
  if (query.brand) filter.brandId = asObjectId(query.brand);
  if (query.type) filter.contentType = query.type;
  if (query.origin) filter.origin = query.origin;
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.due) {
    const now = new Date();
    filter.dueDate = query.due === "overdue" ? { $ne: null, $lt: now } : { $gte: now, $lte: new Date(now.getTime() + 7 * 86_400_000) };
    if (!query.status) filter.status = { $nin: [ContentStatus.POSTED, ContentStatus.COMPLETED, ContentStatus.CANCELLED, ContentStatus.REJECTED] };
  }
  if (query.assignee) {
    const tasks = await tasksRepo.find(
      actor,
      { assignedTo: asObjectId(query.assignee), status: { $in: OPEN_TASK_STATUSES } },
      { limit: 200, projection: { contentId: 1 } },
    );
    filter._id = { $in: [...new Set(tasks.map((t) => String(t.contentId)))].map(asObjectId) };
  }
  if (query.created) {
    const days = { "7d": 7, "30d": 30, "90d": 90 }[query.created];
    filter.createdAt = { $gte: new Date(Date.now() - days * 86_400_000) };
  }
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ title: rx }, { code: rx }];
  }
  const page = query.page ?? 1;
  const [docs, total, ideasPending] = await Promise.all([
    contentRepo.find(actor, filter, {
      sort: { updatedAt: -1 },
      skip: (page - 1) * CONTENT_PAGE_SIZE,
      limit: CONTENT_PAGE_SIZE,
    }),
    contentRepo.count(actor, filter),
    contentRepo.count(actor, { status: ContentStatus.PROPOSED, archivedAt: null }),
  ]);
  const [brands, summaries] = await Promise.all([
    brandSummaries(
      actor.agencyId,
      [...new Set(docs.map((d) => String(d.brandId)))].map(asObjectId),
    ),
    taskSummaries(
      actor.agencyId,
      docs.map((d) => d._id),
    ),
  ]);
  return {
    items: docs.map((d) => ({
      id: String(d._id),
      code: d.code,
      title: d.title,
      brand: {
        id: String(d.brandId),
        name: brands.get(String(d.brandId))?.name ?? "—",
        logoUrl: null,
      },
      contentType: d.contentType,
      origin: d.origin,
      status: d.status,
      priority: d.priority,
      dueDate: d.dueDate?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
      archived: Boolean(d.archivedAt),
      tasks: summaries.get(String(d._id)) ?? { total: 0, done: 0, open: 0, unassigned: 0 },
    })),
    total,
    page,
    pageSize: CONTENT_PAGE_SIZE,
    ideasPending,
  };
}

export type StaffContentView = "assigned" | "ideas" | "brands";

export async function listContentForStaff(
  actor: Actor,
  view: StaffContentView,
): Promise<ContentStaffListItemDTO[]> {
  const myOpen = await tasksRepo.find(
    actor,
    { assignedTo: asObjectId(actor.userId), status: { $in: OPEN_TASK_STATUSES } },
    { limit: 200, projection: { contentId: 1 } },
  );
  const openCount = new Map<string, number>();
  for (const t of myOpen)
    openCount.set(String(t.contentId), (openCount.get(String(t.contentId)) ?? 0) + 1);

  let filter: Record<string, unknown>;
  if (view === "assigned") {
    if (openCount.size === 0) return [];
    filter = { _id: { $in: [...openCount.keys()].map(asObjectId) }, archivedAt: null };
  } else if (view === "ideas") {
    filter = {
      createdBy: asObjectId(actor.userId),
      origin: ContentOrigin.TEAM_IDEA,
      archivedAt: null,
    };
  } else {
    filter = {
      archivedAt: null,
      status: { $nin: [ContentStatus.CANCELLED, ContentStatus.REJECTED] },
    };
  }
  const docs = await contentRepo.find(actor, filter, { sort: { updatedAt: -1 }, limit: 100 });
  const brands = await brandSummaries(
    actor.agencyId,
    [...new Set(docs.map((d) => String(d.brandId)))].map(asObjectId),
  );
  return docs.map((d) => ({
    id: String(d._id),
    code: d.code,
    title: d.title,
    brand: {
      id: String(d.brandId),
      name: brands.get(String(d.brandId))?.name ?? "—",
      logoUrl: null,
    },
    contentType: d.contentType,
    status: d.status,
    priority: d.priority,
    dueDate: d.dueDate?.toISOString() ?? null,
    updatedAt: d.updatedAt.toISOString(),
    myOpenTasks: openCount.get(String(d._id)) ?? 0,
    ideaDecision: d.ideaReview?.decision ?? null,
  }));
}

export async function listContentForClient(
  actor: Actor,
  opts: { awaitingOnly?: boolean } = {},
): Promise<ContentClientDTO[]> {
  const filter: Record<string, unknown> = { archivedAt: null };
  if (opts.awaitingOnly) filter.status = ContentStatus.CLIENT_REVIEW;
  const docs = await contentRepo.find(actor, filter, { sort: { updatedAt: -1 }, limit: 100 });
  if (docs.length === 0) return [];
  const brands = await brandsRepo.find(
    actor,
    { _id: { $in: [...new Set(docs.map((d) => String(d.brandId)))].map(asObjectId) } },
    { limit: 200, projection: { name: 1, logo: 1 } },
  );
  const byId = new Map(brands.map((b) => [String(b._id), b]));
  return docs.flatMap((d) => {
    const b = byId.get(String(d.brandId));
    return b ? [toContentClientDTO(d, b)] : [];
  });
}

export const routeLabel = (r: ProductionRoute) => PRODUCTION_ROUTE_DEFS[r].label;

export interface ContentActivityDTO {
  id: string;
  label: string;
  detail: string | null;
  actorName: string | null;
  at: string;
}

/** Full audit timeline of one content item — ADMIN/MANAGER only (never staff or clients). */
export async function getContentActivity(actor: Actor, contentId: string): Promise<ContentActivityDTO[]> {
  assertCan(canManageContent(actor));
  const c = await getVisibleContent(actor, contentId); // scope → 404
  const rows = await listContentActivity(actor.agencyId, String(c._id), 100);
  return rows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (r.action === "content.status_changed" && m.from && m.to) parts.push(`${String(m.from)} → ${String(m.to)}`.replace(/_/g, " ").toLowerCase());
    if (typeof m.versionNumber === "number") parts.push(`V${m.versionNumber}`);
    if (typeof m.platform === "string") parts.push(m.platform.charAt(0) + m.platform.slice(1).toLowerCase());
    if (typeof m.reason === "string" && m.reason) parts.push(m.reason);
    return {
      id: String(r._id),
      label: activityLabel(r.action),
      detail: parts.length ? parts.join(" · ") : null,
      actorName: r.actorName,
      at: r.createdAt.toISOString(),
    };
  });
}
