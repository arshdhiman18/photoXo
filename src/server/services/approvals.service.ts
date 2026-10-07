import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  ClientApprovalInboxDTO,
  ClientApprovalItemDTO,
  ClientReviewDTO,
  RecentDecisionDTO,
  ReviewQueueItemDTO,
  ReviewQueuesDTO,
  ReviewStateDTO,
} from "@/features/approvals/types";
import type { reopenForChangesSchema } from "@/features/postings/schemas";
import { PostingStatus, targetPlatformsOf } from "@/lib/domain/postings";
import type {
  RecentDecisionsQuery,
  recordClientApprovalSchema,
  reviewDecisionSchema,
  submitForReviewSchema,
} from "@/features/approvals/schemas";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import {
  APPROVAL_TRANSITIONS,
  ApprovalDecision,
  ApprovalEvent,
  ApprovalSource,
  ApprovalStage,
  REVIEW_STATUS,
  approvalEventFor,
  canApplyApprovalEvent,
  commentVisibilityFor,
} from "@/lib/domain/approvals";
import { ContentStatus, VERSION_TASK_TYPES, routeReviewGates } from "@/lib/domain/content";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/authz/errors";
import {
  assertCan,
  canApproveContent,
  canGiveClientApproval,
  canManageClientApprovals,
  canManageContent,
  canProposeIdeas,
  canRecordClientApprovalOnBehalf,
  canReopenApprovedContent,
  canStartRevision,
} from "@/server/authz/permissions";
import type { ApprovalDoc, ContentDoc, ContentVersionDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import {
  clientStateOf,
  clientStatusLabel,
  toApprovalRecordDTO,
  toClientApprovalRecordDTO,
  toClientVersionDTO,
} from "@/server/dto/approvals";
import {
  approvalsRepo,
  insertApproval,
  isInternallyApproved,
  versionDecisionCount,
  versionOfContent,
} from "@/server/repositories/approvals.repo";
import { brandsRepo, brandSummaries } from "@/server/repositories/brands.repo";
import {
  assetsByIds,
  contentRepo,
  peopleByIds,
  syncVersionTasks,
  tasksRepo,
  versionsRepo,
} from "@/server/repositories/content.repo";
import { livePostingsForVersion, updatePosting } from "@/server/repositories/postings.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import {
  onClientDecision,
  onInternalDecision,
  onReopenedForChanges,
  onRevisionStarted,
  onSubmittedForInternalReview,
} from "@/server/notifications/events";
import { getVisibleContent } from "./content.service";
import { listClientPosts } from "./postings.service";

type SubmitInput = z.output<typeof submitForReviewSchema>;
type DecisionInput = z.output<typeof reviewDecisionSchema>;
type RecordInput = z.output<typeof recordClientApprovalSchema>;
type ReopenInput = z.output<typeof reopenForChangesSchema>;

/*
 * The approval workflow. Every move into or out of review happens here, and
 * only together with the record that justifies it (a submission, or an
 * append-only approval decision), in ONE transaction with its audit entries.
 *
 * Scope: content is always loaded through the scoped content repository, so
 * agency + brand (+ client membership) are enforced before anything else;
 * a version is then accepted only if it belongs to that exact content. The
 * browser-supplied versionId is never trusted as state — it must equal the
 * content's own review pointer (stale/foreign versions are refused).
 *
 * Brand authority for internal reviewers comes from the same scoped
 * repository (Stage 1/2: ADMIN and MANAGER have agency-wide brand access).
 */

const STALE_VERSION = "You're looking at an older version. Refresh to review the current one.";
const CHANGED = "This content changed since you opened it. Refresh and try again.";

const DECISION_ACTION: Record<ApprovalSource, Record<ApprovalDecision, ActivityAction>> = {
  REVIEWER: {
    APPROVED: ActivityAction.APPROVAL_INTERNAL_APPROVED,
    CHANGES_REQUESTED: ActivityAction.APPROVAL_INTERNAL_CHANGES_REQUESTED,
  },
  CLIENT_USER: {
    APPROVED: ActivityAction.APPROVAL_CLIENT_APPROVED,
    CHANGES_REQUESTED: ActivityAction.APPROVAL_CLIENT_CHANGES_REQUESTED,
  },
  RECORDED_BY_ADMIN: {
    APPROVED: ActivityAction.APPROVAL_CLIENT_RECORDED_BY_ADMIN,
    CHANGES_REQUESTED: ActivityAction.APPROVAL_CLIENT_RECORDED_BY_ADMIN,
  },
};

function auditContent(actor: Actor, action: ActivityAction, c: Pick<ContentDoc, "_id" | "brandId">, meta: Record<string, unknown>) {
  return recordActivity({
    actor,
    action,
    entity: { kind: ActivityEntityKind.CONTENT, id: String(c._id) },
    brandId: String(c.brandId),
    meta,
  });
}

/**
 * Apply one approval event: conditional on the status (and any extra
 * preconditions such as the version under review), so a concurrent change
 * makes this fail and the whole transaction roll back.
 */
async function moveContent(
  actor: Actor,
  content: ContentDoc,
  event: ApprovalEvent,
  set: Record<string, unknown>,
  where: Record<string, unknown>,
  meta: Record<string, unknown>,
  extra: { push?: Record<string, unknown> } = {},
): Promise<ContentDoc> {
  const t = APPROVAL_TRANSITIONS[event];
  if (!canApplyApprovalEvent(content.status, event)) throw new ConflictError(CHANGED);
  const updated = await contentRepo.updateById(
    actor,
    String(content._id),
    { $set: { status: t.to, statusChangedAt: new Date(), ...set }, ...(extra.push ? { $push: extra.push } : {}) },
    { status: content.status, archivedAt: null, ...where },
  );
  if (!updated) throw new ConflictError(CHANGED);
  await auditContent(actor, ActivityAction.CONTENT_STATUS_CHANGED, content, {
    from: content.status,
    to: t.to,
    event,
    ...meta,
  });
  // Submitting for review = the creator's task is done; changes requested = it's theirs again.
  const mode = t.to === "INTERNAL_REVIEW" ? "complete" : t.to === "CHANGES_REQUESTED" ? "reopen" : null;
  if (mode) {
    for (const { task, to } of await syncVersionTasks(actor.agencyId, String(content._id), mode)) {
      await recordActivity({
        actor,
        action: ActivityAction.TASK_STATUS_CHANGED,
        entity: { kind: ActivityEntityKind.PRODUCTION_TASK, id: String(task._id) },
        brandId: String(task.brandId),
        meta: { contentId: String(content._id), from: task.status, to, reason: mode === "complete" ? "submitted_for_review" : "changes_requested" },
      });
    }
  }
  return updated;
}

// ── Submit for internal review ───────────────────────────────────────────

async function isVersionTaskAssignee(actor: Actor, c: ContentDoc): Promise<boolean> {
  const n = await tasksRepo.count(actor, {
    contentId: c._id,
    assignedTo: asObjectId(actor.userId),
    status: { $ne: "CANCELLED" },
    taskType: { $in: VERSION_TASK_TYPES },
  });
  return n > 0;
}

type SubmissionCheck =
  | { allowed: true; version: ContentVersionDoc }
  | { allowed: false; forbidden: boolean; reason: string };

/**
 * Who: a manager, or the assignee of a version-producing task on this
 * content (the same people who may add versions, Stage 3).
 * What: the content's CURRENT version, never reviewed before, while the
 * content is IN_PRODUCTION or CHANGES_REQUESTED and its route has an
 * INTERNAL review gate.
 */
async function checkSubmission(actor: Actor, c: ContentDoc): Promise<SubmissionCheck> {
  if (!canProposeIdeas(actor)) return { allowed: false, forbidden: true, reason: "Not allowed." };
  if (!canManageContent(actor) && !(await isVersionTaskAssignee(actor, c))) {
    return {
      allowed: false,
      forbidden: true,
      reason: "Only the assigned creator or a manager can submit this for review.",
    };
  }
  const no = (reason: string): SubmissionCheck => ({ allowed: false, forbidden: false, reason });
  if (c.archivedAt) return no("Archived content can't be submitted.");
  if (!routeReviewGates(c.route).includes(ApprovalStage.INTERNAL)) {
    return no("This content's production route has no internal review step.");
  }
  if (!canApplyApprovalEvent(c.status, ApprovalEvent.SUBMIT_INTERNAL)) {
    return no("Only content in production, or with changes requested, can be submitted for review.");
  }
  if (!c.currentVersionId) return no("Add a version before submitting for review.");
  const version = await versionOfContent(c, c.currentVersionId);
  if (!version) return no("Add a version before submitting for review.");
  if ((await versionDecisionCount(c.agencyId, version._id)) > 0) {
    return no(`V${version.versionNumber} has already been reviewed. Add a new version with the requested changes.`);
  }
  return { allowed: true, version };
}

export async function submitForInternalReview(actor: Actor, input: SubmitInput): Promise<void> {
  assertCan(canProposeIdeas(actor)); // never clients
  const c = await getVisibleContent(actor, input.contentId); // scope → 404
  const check = await checkSubmission(actor, c);
  if (!check.allowed) {
    throw check.forbidden ? new ForbiddenError(check.reason) : new ConflictError(check.reason);
  }
  const v = check.version;
  if (String(v._id) !== input.versionId) {
    throw new ConflictError(`A newer version exists (V${v.versionNumber}). Refresh and submit the latest version.`);
  }
  await withTransaction(async () => {
    const meta = { versionId: String(v._id), versionNumber: v.versionNumber };
    await moveContent(
      actor,
      c,
      ApprovalEvent.SUBMIT_INTERNAL,
      {
        reviewSubmission: {
          versionId: v._id,
          versionNumber: v.versionNumber,
          submittedBy: asObjectId(actor.userId),
          submittedAt: new Date(),
        },
        // A new review cycle: approvals of earlier versions never carry over.
        internalApprovedVersionId: null,
        clientApprovedVersionId: null,
        readyToPostAt: null,
      },
      { currentVersionId: v._id },
      meta,
    );
    await auditContent(actor, ActivityAction.APPROVAL_SUBMITTED_INTERNAL, c, meta);
    await onSubmittedForInternalReview(actor, c, v);
  });
}

// ── Decisions ────────────────────────────────────────────────────────────

/**
 * Load and verify the exact content + version a decision applies to:
 * scope (404) → route gate → status matches the gate → the version is the
 * one under review → it belongs to this content → (client gate) it passed
 * the internal gate → not already decided at this gate.
 */
async function loadDecisionTarget(actor: Actor, contentId: string, versionId: string, stage: ApprovalStage) {
  const content = await getVisibleContent(actor, contentId);
  if (content.archivedAt) throw new ConflictError("Archived content can't be reviewed.");
  if (!routeReviewGates(content.route).includes(stage)) {
    throw new ConflictError("This content's production route has no such review step.");
  }
  if (content.status !== REVIEW_STATUS[stage]) {
    throw new ConflictError(
      stage === ApprovalStage.INTERNAL
        ? "This content isn't waiting for internal review."
        : "This content isn't waiting for client approval.",
    );
  }
  const sub = content.reviewSubmission;
  if (!sub || String(sub.versionId) !== versionId) throw new ConflictError(STALE_VERSION);
  const version = await versionOfContent(content, sub.versionId);
  if (!version) throw new NotFoundError();
  if (stage === ApprovalStage.CLIENT) {
    const passed =
      content.internalApprovedVersionId &&
      String(content.internalApprovedVersionId) === versionId &&
      (await isInternallyApproved(content.agencyId, version._id));
    if (!passed) throw new ConflictError("This version hasn't passed internal review.");
  }
  if ((await versionDecisionCount(content.agencyId, version._id, stage)) > 0) {
    throw new ConflictError("This version has already been decided at this stage.");
  }
  return { content, version };
}

async function decide(
  actor: Actor,
  content: ContentDoc,
  version: ContentVersionDoc,
  stage: ApprovalStage,
  decision: ApprovalDecision,
  comment: string | null,
  source: ApprovalSource,
): Promise<{ approvalId: string }> {
  // Posting needs a valid platform configuration before content can be approved onwards.
  if (decision === ApprovalDecision.APPROVED && targetPlatformsOf(content).length === 0) {
    throw new ConflictError(
      source === ApprovalSource.CLIENT_USER
        ? "This can't be approved just yet — please contact your agency team."
        : "Set the platforms this content will be posted to before approving it.",
    );
  }
  return withTransaction(async () => {
    const now = new Date();
    const approval = await insertApproval({
      agencyId: content.agencyId,
      brandId: content.brandId,
      contentId: content._id,
      contentVersionId: version._id,
      versionNumber: version.versionNumber,
      stage,
      decision,
      comment,
      commentVisibility: commentVisibilityFor(stage, source),
      source,
      decidedBy: asObjectId(actor.userId),
      decidedAt: now,
    });
    const approved = decision === ApprovalDecision.APPROVED;
    const set: Record<string, unknown> = approved
      ? stage === ApprovalStage.INTERNAL
        ? { internalApprovedVersionId: version._id, clientChangesPending: false }
        : { clientApprovedVersionId: version._id, readyToPostAt: now, clientChangesPending: false }
      : {
          changesRequestedBy: {
            stage,
            source,
            approvalId: approval._id,
            versionId: version._id,
            versionNumber: version.versionNumber,
            comment: comment ?? "",
            decidedBy: asObjectId(actor.userId),
            decidedAt: now,
          },
          ...(stage === ApprovalStage.CLIENT ? { clientChangesPending: true } : {}),
        };
    const where: Record<string, unknown> = { "reviewSubmission.versionId": version._id };
    if (stage === ApprovalStage.CLIENT) where.internalApprovedVersionId = version._id;
    const meta = {
      approvalId: String(approval._id),
      versionId: String(version._id),
      versionNumber: version.versionNumber,
      stage,
      decision,
      source,
    };
    await moveContent(actor, content, approvalEventFor(stage, decision), set, where, meta);
    await recordActivity({
      actor,
      action: DECISION_ACTION[source][decision],
      entity: { kind: ActivityEntityKind.APPROVAL, id: String(approval._id) },
      brandId: String(content.brandId),
      meta: { ...meta, contentId: String(content._id) },
    });
    if (stage === ApprovalStage.INTERNAL && approved) {
      await auditContent(actor, ActivityAction.APPROVAL_SUBMITTED_CLIENT, content, {
        versionId: String(version._id),
        versionNumber: version.versionNumber,
      });
    }
    if (stage === ApprovalStage.INTERNAL) await onInternalDecision(actor, content, version, approved, approval._id, comment);
    else await onClientDecision(actor, content, version, approved, approval._id, comment);
    return { approvalId: String(approval._id) };
  });
}

/** ADMIN / MANAGER decide the INTERNAL gate. */
export async function decideInternalReview(actor: Actor, input: DecisionInput) {
  assertCan(canApproveContent(actor));
  const { content, version } = await loadDecisionTarget(actor, input.contentId, input.versionId, ApprovalStage.INTERNAL);
  return decide(actor, content, version, ApprovalStage.INTERNAL, input.decision, input.comment, ApprovalSource.REVIEWER);
}

/** A client user decides the CLIENT gate personally (own brand only — content scope). */
export async function decideClientReview(actor: Actor, input: DecisionInput) {
  assertCan(canGiveClientApproval(actor));
  const { content, version } = await loadDecisionTarget(actor, input.contentId, input.versionId, ApprovalStage.CLIENT);
  return decide(actor, content, version, ApprovalStage.CLIENT, input.decision, input.comment, ApprovalSource.CLIENT_USER);
}

/**
 * ADMIN records a client approval given outside the portal. Stored as
 * RECORDED_BY_ADMIN with the admin as `decidedBy` and the note as an
 * internal comment — never presented as the client's own click.
 */
export async function recordClientApprovalOnBehalf(actor: Actor, input: RecordInput) {
  assertCan(canRecordClientApprovalOnBehalf(actor));
  const { content, version } = await loadDecisionTarget(actor, input.contentId, input.versionId, ApprovalStage.CLIENT);
  return decide(
    actor,
    content,
    version,
    ApprovalStage.CLIENT,
    ApprovalDecision.APPROVED,
    input.note,
    ApprovalSource.RECORDED_BY_ADMIN,
  );
}

/**
 * ADMIN/MANAGER send client-approved content back for changes BEFORE anything
 * is posted: READY_TO_POST → CHANGES_REQUESTED. Recorded as an INTERNAL
 * change request on the approved version (append-only), so that version can
 * never be resubmitted — a new version must go through internal AND client
 * review again. Started-but-unconfirmed platform postings are cancelled (kept
 * for history). Once any platform is POSTED this is refused (architect review).
 */
export async function reopenForChanges(actor: Actor, input: ReopenInput) {
  assertCan(canReopenApprovedContent(actor));
  const content = await getVisibleContent(actor, input.contentId);
  if (content.archivedAt) throw new ConflictError("Archived content can't be changed.");
  if (!canApplyApprovalEvent(content.status, ApprovalEvent.REOPEN_FOR_CHANGES)) {
    throw new ConflictError("Only approved content that is waiting to be posted can be sent back for changes.");
  }
  const approvedId = content.clientApprovedVersionId;
  if (!approvedId || String(approvedId) !== input.versionId) throw new ConflictError(STALE_VERSION);
  const version = await versionOfContent(content, approvedId);
  if (!version) throw new NotFoundError();
  return withTransaction(async () => {
    const live = await livePostingsForVersion(content.agencyId, version._id);
    if (live.some((p) => p.status === PostingStatus.POSTED)) {
      throw new ConflictError(
        "Already posted on at least one platform. Posted work can't be sent back through this flow; its posting history stays as is.",
      );
    }
    const now = new Date();
    for (const p of live) {
      const cancelled = await updatePosting(content.agencyId, p._id, { status: PostingStatus.POSTING, live: true }, {
        $set: { status: PostingStatus.CANCELLED, live: false, cancelledAt: now, cancelledBy: asObjectId(actor.userId), cancelReason: input.reason },
      });
      if (!cancelled) throw new ConflictError(CHANGED);
      await recordActivity({
        actor,
        action: ActivityAction.POSTING_CANCELLED,
        entity: { kind: ActivityEntityKind.POSTING, id: String(p._id) },
        brandId: String(content.brandId),
        meta: { contentId: input.contentId, platform: p.platform, reason: input.reason },
      });
    }
    const approval = await insertApproval({
      agencyId: content.agencyId,
      brandId: content.brandId,
      contentId: content._id,
      contentVersionId: version._id,
      versionNumber: version.versionNumber,
      stage: ApprovalStage.INTERNAL,
      decision: ApprovalDecision.CHANGES_REQUESTED,
      comment: input.reason,
      commentVisibility: commentVisibilityFor(ApprovalStage.INTERNAL, ApprovalSource.REVIEWER),
      source: ApprovalSource.REVIEWER,
      decidedBy: asObjectId(actor.userId),
      decidedAt: now,
    });
    const meta = {
      approvalId: String(approval._id),
      versionId: String(version._id),
      versionNumber: version.versionNumber,
      cancelledPostings: live.length,
    };
    await moveContent(
      actor,
      content,
      ApprovalEvent.REOPEN_FOR_CHANGES,
      {
        changesRequestedBy: {
          stage: ApprovalStage.INTERNAL,
          source: ApprovalSource.REVIEWER,
          approvalId: approval._id,
          versionId: version._id,
          versionNumber: version.versionNumber,
          comment: input.reason,
          decidedBy: asObjectId(actor.userId),
          decidedAt: now,
        },
        // Architect decision (Stage 7): the client already approved this item, so it
        // must not silently disappear — they see a client-safe "Changes in progress".
        clientChangesPending: true,
      },
      { clientApprovedVersionId: version._id },
      meta,
    );
    await recordActivity({
      actor,
      action: ActivityAction.APPROVAL_REOPENED_FOR_CHANGES,
      entity: { kind: ActivityEntityKind.APPROVAL, id: String(approval._id) },
      brandId: String(content.brandId),
      meta: { ...meta, contentId: input.contentId },
    });
    await onReopenedForChanges(actor, content, version, approval._id, input.reason);
    return { approvalId: String(approval._id) };
  });
}

/**
 * Post-publication revision (ADMIN/MANAGER, reason required). Allowed for
 * POSTED / COMPLETED content, and for READY_TO_POST content where at least
 * one platform is already POSTED (nothing posted → use "send back for
 * changes"). The same Content record re-enters production as
 * CHANGES_REQUESTED; the posted version, its approvals and every posting
 * record stay exactly as they were. A NEW version must then pass internal
 * review, client review and its own posting round (Stage 5/6 workflow).
 */
export async function startRevision(actor: Actor, input: { contentId: string; reason: string }) {
  assertCan(canStartRevision(actor));
  const content = await getVisibleContent(actor, input.contentId);
  if (content.archivedAt) throw new ConflictError("Archived content can't be revised.");
  const brand = await brandsRepo.getById(actor, String(content.brandId));
  if (brand.status !== "ACTIVE") throw new ConflictError("This brand is archived — no new work.");
  if (!canApplyApprovalEvent(content.status, ApprovalEvent.START_REVISION)) {
    throw new ConflictError("Only posted or completed content can get a new revision.");
  }
  const fromId = content.clientApprovedVersionId;
  if (!fromId) throw new ConflictError("This content has no approved version to revise.");
  const from = await versionOfContent(content, fromId);
  if (!from) throw new NotFoundError();
  return withTransaction(async () => {
    if (content.status === ContentStatus.READY_TO_POST) {
      const live = await livePostingsForVersion(content.agencyId, from._id);
      if (!live.some((p) => p.status === PostingStatus.POSTED)) {
        throw new ConflictError("Nothing has been posted yet — send it back for changes instead.");
      }
    }
    const now = new Date();
    const n = (content.revisionCount ?? 0) + 1;
    const meta = {
      revision: n,
      fromVersionId: String(from._id),
      fromVersionNumber: from.versionNumber,
      previousStatus: content.status,
      reason: input.reason,
    };
    await moveContent(
      actor,
      content,
      ApprovalEvent.START_REVISION,
      {
        changesRequestedBy: {
          stage: ApprovalStage.INTERNAL,
          source: ApprovalSource.REVIEWER,
          approvalId: null,
          revision: n,
          versionId: from._id,
          versionNumber: from.versionNumber,
          comment: input.reason,
          decidedBy: asObjectId(actor.userId),
          decidedAt: now,
        },
        clientChangesPending: true, // client sees "Changes in progress", never internal detail
        revisionCount: n,
        // Current-cycle markers reset; the previous cycle's are kept in `revisions`.
        readyToPostAt: null,
        postedAt: null,
        completedAt: null,
      },
      { clientApprovedVersionId: from._id, revisionCount: content.revisionCount ?? { $exists: false } },
      meta,
      {
        push: {
          revisions: {
            number: n,
            reason: input.reason,
            startedBy: asObjectId(actor.userId),
            startedAt: now,
            fromVersionId: from._id,
            fromVersionNumber: from.versionNumber,
            previousStatus: content.status,
            previousPostedAt: content.postedAt ?? null,
            previousCompletedAt: content.completedAt ?? null,
          },
        },
      },
    );
    await auditContent(actor, ActivityAction.CONTENT_REVISION_STARTED, content, meta);
    await onRevisionStarted(actor, content, from, n, input.reason);
    return { revision: n };
  });
}

// ── Internal reads ───────────────────────────────────────────────────────

/** Review state + full approval history for internal users (never clients). */
export async function getReviewState(actor: Actor, contentId: string): Promise<ReviewStateDTO> {
  if (!canProposeIdeas(actor)) throw new NotFoundError();
  const c = await getVisibleContent(actor, contentId);
  const approvedIds = [c.internalApprovedVersionId, c.clientApprovedVersionId].filter(
    (id): id is Types.ObjectId => Boolean(id),
  );
  const [history, approvedVersions, check] = await Promise.all([
    approvalsRepo.find(actor, { contentId: c._id }, { sort: { decidedAt: -1 }, limit: 200 }),
    approvedIds.length
      ? versionsRepo.find(actor, { _id: { $in: approvedIds } }, { limit: 2, projection: { versionNumber: 1 } })
      : Promise.resolve([]),
    checkSubmission(actor, c),
  ]);
  const people = await peopleByIds(actor.agencyId, [
    ...history.map((h) => h.decidedBy),
    c.reviewSubmission?.submittedBy,
    c.changesRequestedBy?.decidedBy,
    ...(c.revisions ?? []).map((r) => r.startedBy),
  ]);
  const numberOf = (id: Types.ObjectId | null) =>
    id ? (approvedVersions.find((v) => String(v._id) === String(id))?.versionNumber ?? null) : null;
  const inReview = c.status === ContentStatus.INTERNAL_REVIEW || c.status === ContentStatus.CLIENT_REVIEW;
  const sub = c.reviewSubmission;
  const cr = c.changesRequestedBy;
  return {
    contentId: String(c._id),
    status: c.status,
    gates: routeReviewGates(c.route),
    underReview:
      inReview && sub
        ? {
            versionId: String(sub.versionId),
            versionNumber: sub.versionNumber,
            submittedBy: people.get(String(sub.submittedBy)) ?? null,
            submittedAt: sub.submittedAt.toISOString(),
          }
        : null,
    internalApprovedVersionNumber: numberOf(c.internalApprovedVersionId),
    clientApprovedVersionNumber: numberOf(c.clientApprovedVersionId),
    changeRequest: cr
      ? {
          revision: cr.revision ?? null,
          stage: cr.stage,
          source: cr.source,
          versionNumber: cr.versionNumber,
          comment: cr.comment,
          decidedBy: people.get(String(cr.decidedBy)) ?? null,
          decidedAt: cr.decidedAt.toISOString(),
        }
      : null,
    history: history.map((h) => toApprovalRecordDTO(h, people)),
    revisions: [...(c.revisions ?? [])].reverse().map((r) => ({
      number: r.number,
      reason: r.reason,
      startedBy: people.get(String(r.startedBy)) ?? null,
      startedAt: r.startedAt.toISOString(),
      fromVersionNumber: r.fromVersionNumber,
      previousStatus: r.previousStatus,
    })),
    canSubmit: check.allowed
      ? { versionId: String(check.version._id), versionNumber: check.version.versionNumber }
      : null,
    submitHint: !check.allowed && !check.forbidden ? check.reason : null,
    canDecideInternal: canApproveContent(actor) && c.status === ContentStatus.INTERNAL_REVIEW && !c.archivedAt,
    canRecordClientApproval:
      canRecordClientApprovalOnBehalf(actor) && c.status === ContentStatus.CLIENT_REVIEW && !c.archivedAt,
  };
}

function toQueueItem(d: ContentDoc, brands: Map<string, { name: string }>): ReviewQueueItemDTO {
  const cr = d.changesRequestedBy;
  return {
    id: String(d._id),
    code: d.code,
    title: d.title,
    brand: { id: String(d.brandId), name: brands.get(String(d.brandId))?.name ?? "—", logoUrl: null },
    contentType: d.contentType,
    status: d.status,
    versionNumber: d.reviewSubmission?.versionNumber ?? null,
    waitingSince: d.statusChangedAt.toISOString(),
    changeRequest:
      d.status === ContentStatus.CHANGES_REQUESTED && cr
        ? { stage: cr.stage, source: cr.source, comment: cr.comment, versionNumber: cr.versionNumber }
        : null,
  };
}

/** Internal review queue, client-review visibility and open change requests (oldest first). */
export async function listReviewQueues(actor: Actor, opts: { brandId?: string } = {}): Promise<ReviewQueuesDTO> {
  assertCan(canManageClientApprovals(actor));
  const base: Record<string, unknown> = { archivedAt: null };
  if (opts.brandId) base.brandId = asObjectId(opts.brandId);
  const statuses = [ContentStatus.INTERNAL_REVIEW, ContentStatus.CLIENT_REVIEW, ContentStatus.CHANGES_REQUESTED];
  const [internal, client, changes] = await Promise.all(
    statuses.map((status) =>
      contentRepo.find(actor, { ...base, status }, { sort: { statusChangedAt: 1 }, limit: 100 }),
    ),
  );
  const all = [...internal!, ...client!, ...changes!];
  const brands = await brandSummaries(actor.agencyId, [...new Set(all.map((d) => String(d.brandId)))].map(asObjectId));
  return {
    internal: internal!.map((d) => toQueueItem(d, brands)),
    client: client!.map((d) => toQueueItem(d, brands)),
    changes: changes!.map((d) => toQueueItem(d, brands)),
  };
}

/** Recent decisions across the agency (or one brand), filterable by gate and decision. */
export async function listRecentDecisions(
  actor: Actor,
  query: RecentDecisionsQuery,
): Promise<RecentDecisionDTO[]> {
  assertCan(canManageClientApprovals(actor));
  const filter: Record<string, unknown> = {};
  if (query.stage) filter.stage = query.stage;
  if (query.decision) filter.decision = query.decision;
  if (query.brand) filter.brandId = asObjectId(query.brand);
  const rows = await approvalsRepo.find(actor, filter, { sort: { decidedAt: -1 }, limit: 50 });
  if (rows.length === 0) return [];
  const [contents, people, brands] = await Promise.all([
    contentRepo.find(
      actor,
      { _id: { $in: [...new Set(rows.map((r) => String(r.contentId)))].map(asObjectId) } },
      { limit: 50, projection: { code: 1, title: 1 } },
    ),
    peopleByIds(actor.agencyId, rows.map((r) => r.decidedBy)),
    brandSummaries(actor.agencyId, [...new Set(rows.map((r) => String(r.brandId)))].map(asObjectId)),
  ]);
  const byId = new Map(contents.map((c) => [String(c._id), c]));
  return rows.flatMap((r) => {
    const c = byId.get(String(r.contentId));
    if (!c) return [];
    return [
      {
        ...toApprovalRecordDTO(r, people),
        content: { id: String(c._id), code: c.code, title: c.title },
        brand: { id: String(r.brandId), name: brands.get(String(r.brandId))?.name ?? "—" },
      },
    ];
  });
}

// ── Client reads ─────────────────────────────────────────────────────────

/** The client's approval inbox: awaiting them, changes they asked for, approved. */
export async function listClientApprovals(actor: Actor): Promise<ClientApprovalInboxDTO> {
  assertCan(canGiveClientApproval(actor));
  const docs = await contentRepo.find(actor, { archivedAt: null }, { sort: { statusChangedAt: 1 }, limit: 200 });
  const inbox: ClientApprovalInboxDTO = { awaiting: [], changes: [], approved: [] };
  if (docs.length === 0) return inbox;
  const brands = await brandsRepo.find(
    actor,
    { _id: { $in: [...new Set(docs.map((d) => String(d.brandId)))].map(asObjectId) } },
    { limit: 200, projection: { name: 1, logo: 1 } },
  );
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  for (const d of docs) {
    const state = clientStateOf(d);
    const b = brandById.get(String(d.brandId));
    if (!state || !b) continue;
    const item: ClientApprovalItemDTO = {
      id: String(d._id),
      title: d.title,
      brand: { id: String(b._id), name: b.name, logoUrl: b.logo?.url ?? null },
      contentType: d.contentType,
      state,
      statusLabel: clientStatusLabel(d),
      since: d.statusChangedAt.toISOString(),
    };
    if (state === "AWAITING") inbox.awaiting.push(item);
    else if (state === "CHANGES") inbox.changes.push(item);
    else inbox.approved.unshift(item); // newest approvals first
  }
  return inbox;
}

/**
 * Exactly what the client is approving. The shown version is always one that
 * passed the INTERNAL gate: the version under client review, the approved
 * version, or (while changes are in progress) the version they last decided.
 */
export async function getClientReview(actor: Actor, contentId: string): Promise<ClientReviewDTO> {
  assertCan(canGiveClientApproval(actor));
  const c = await getVisibleContent(actor, contentId); // own CLIENT brands + client-facing states
  const state = clientStateOf(c);
  if (!state) throw new NotFoundError();
  const [brand, history] = await Promise.all([
    brandsRepo.getById(actor, String(c.brandId)),
    approvalsRepo.find(actor, { contentId: c._id }, { sort: { decidedAt: -1 }, limit: 100 }) as Promise<ApprovalDoc[]>,
  ]);

  let versionId: Types.ObjectId | null = null;
  if (state === "AWAITING") versionId = c.reviewSubmission?.versionId ?? null;
  else if (state === "APPROVED") versionId = c.clientApprovedVersionId;
  else versionId = history[0]?.contentVersionId ?? null;

  let version: ContentVersionDoc | null = versionId ? await versionOfContent(c, versionId) : null;
  if (version && !(await isInternallyApproved(c.agencyId, version._id))) version = null;
  const assets = version ? await assetsByIds(actor.agencyId, version.assetIds) : new Map();

  // Names of OTHER client users only (never staff/admin names).
  const clientIds = history
    .filter((h) => h.source === ApprovalSource.CLIENT_USER && String(h.decidedBy) !== actor.userId)
    .map((h) => h.decidedBy);
  const people = await peopleByIds(actor.agencyId, clientIds);
  const clientNames = new Map([...people].map(([id, p]) => [id, p.name]));

  return {
    id: String(c._id),
    title: c.title,
    brand: { id: String(brand._id), name: brand.name, logoUrl: brand.logo?.url ?? null },
    contentType: c.contentType,
    state,
    statusLabel: clientStatusLabel(c),
    version: version ? toClientVersionDTO(version, assets) : null,
    canDecide: state === "AWAITING" && Boolean(version),
    posts: state === "APPROVED" ? await listClientPosts(actor, c) : [],
    history: history
      .filter((h) => h.stage === ApprovalStage.CLIENT)
      .map((h) => toClientApprovalRecordDTO(h, actor, clientNames)),
  };
}
