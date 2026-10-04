import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  ApprovedVersionDTO,
  ClientPostDTO,
  PlatformRowDTO,
  PostingHistoryItemDTO,
  PostingQueueItemDTO,
  PostingRecordDTO,
  PostingWorkspaceDTO,
  UploaderStateDTO,
} from "@/features/postings/types";
import type {
  confirmPostedSchema,
  correctPostingSchema,
  recordPostingOnBehalfSchema,
  startPostingSchema,
  targetPlatformsSchema,
} from "@/features/postings/schemas";
import type { PersonRef } from "@/features/content/types";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { BrandStatus } from "@/lib/domain/brands";
import { ContentStatus, detectAssetProvider } from "@/lib/domain/content";
import {
  POSTING_TRANSITIONS,
  PostingSource,
  PostingStatus,
  TARGET_PLATFORMS_EDITABLE,
  allRequiredPosted,
  normalizePostUrl,
  targetPlatformsOf,
  type PlatformState,
  type PostingPlatform,
} from "@/lib/domain/postings";
import { SystemRole } from "@/lib/domain/roles";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/authz/errors";
import {
  assertCan,
  canCorrectPostings,
  canProposeIdeas,
  canRecordPostingOnBehalf,
  canReopenApprovedContent,
  canSetTargetPlatforms,
  canStartRevision,
  canViewPostings,
} from "@/server/authz/permissions";
import type { BrandDoc, ContentDoc, ContentVersionDoc, PostingDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { toVersionDTO } from "@/server/dto/content";
import { approvalsRepo, versionOfContent } from "@/server/repositories/approvals.repo";
import { brandsRepo, brandSummaries } from "@/server/repositories/brands.repo";
import { assetsByIds, contentRepo, insertAssets, peopleByIds } from "@/server/repositories/content.repo";
import {
  approvalsStillHold,
  insertPosting,
  livePostingsForVersion,
  postingsRepo,
  resolveEffectiveUploader,
  updatePosting,
  type UploaderResolution,
} from "@/server/repositories/postings.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { onContentPosted } from "@/server/notifications/events";
import { getVisibleContent } from "./content.service";

type StartInput = z.output<typeof startPostingSchema>;
type ConfirmInput = z.output<typeof confirmPostedSchema>;
type OnBehalfInput = z.output<typeof recordPostingOnBehalfSchema>;
type CorrectInput = z.output<typeof correctPostingSchema>;
type PlatformsInput = z.output<typeof targetPlatformsSchema>;

/*
 * Posting workflow: READY_TO_POST → (per platform) POSTING → POSTED → when
 * every required platform is POSTED for the client-approved version, the
 * content moves READY_TO_POST → POSTED → COMPLETED in the same transaction.
 *
 * Every command re-derives the truth server-side: the content (scoped → 404),
 * its brand (must be ACTIVE), the client-approved version (must belong to the
 * content and still hold both approval records), the required platforms (from
 * the content, never the browser) and the effective uploader (central rule).
 */

const MAX_FUTURE_MS = 5 * 60_000;

function audit(
  actor: Actor,
  action: ActivityAction,
  entity: { kind: ActivityEntityKind; id: string },
  brandId: Types.ObjectId,
  meta: Record<string, unknown>,
) {
  return recordActivity({ actor, action, entity, brandId: String(brandId), meta });
}

interface PostingContext {
  content: ContentDoc;
  brand: BrandDoc;
  version: ContentVersionDoc;
  uploader: UploaderResolution;
}

/**
 * Verify everything a posting action depends on. `versionId` is what the
 * browser shows; it must equal the content's clientApprovedVersionId.
 */
async function loadPostingContext(
  actor: Actor,
  contentId: string,
  versionId: string,
  platform: PostingPlatform,
): Promise<PostingContext> {
  const content = await getVisibleContent(actor, contentId); // agency + brand scope → 404
  const brand = await brandsRepo.getById(actor, String(content.brandId));
  if (brand.status !== BrandStatus.ACTIVE) throw new ConflictError("This brand is archived — no new posting work.");
  if (content.archivedAt) throw new ConflictError("Archived content can't be posted.");
  if (content.status !== ContentStatus.READY_TO_POST) throw new ConflictError("This content isn't ready to post.");
  const approvedId = content.clientApprovedVersionId;
  if (!approvedId || String(content.internalApprovedVersionId) !== String(approvedId)) {
    throw new ConflictError("This content has no valid client-approved version.");
  }
  if (String(approvedId) !== versionId) {
    throw new ConflictError("Only the client-approved version can be posted. Refresh and try again.");
  }
  const version = await versionOfContent(content, approvedId);
  if (!version) throw new NotFoundError();
  if (!(await approvalsStillHold(content.agencyId, version._id))) {
    throw new ConflictError("The approvals for this version are incomplete.");
  }
  if (!targetPlatformsOf(content).includes(platform)) {
    throw new ValidationError("This content doesn't need to be posted there.", { platform: ["Not a required platform"] });
  }
  const uploader = await resolveEffectiveUploader(content.agencyId, brand, content);
  return { content, brand, version, uploader };
}

function assertIsAssignedUploader(actor: Actor, u: UploaderResolution) {
  if (!u.valid || u.userId !== actor.userId) {
    throw new ForbiddenError("Only the assigned uploader can record posts for this content.");
  }
}

/**
 * Lock the content row for this transaction (a no-op write, conditional on
 * READY_TO_POST + the approved version): concurrent posting actions on the
 * same content conflict and are retried, so the completion check always sees
 * every committed platform.
 */
async function lockReadyContent(actor: Actor, ctx: PostingContext) {
  const ok = await contentRepo.updateById(
    actor,
    String(ctx.content._id),
    { $set: { statusChangedAt: ctx.content.statusChangedAt } },
    { status: ContentStatus.READY_TO_POST, clientApprovedVersionId: ctx.version._id, archivedAt: null },
  );
  if (!ok) throw new ConflictError("This content changed. Refresh and try again.");
}

function parsePostedAt(raw: string | null): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ValidationError("Invalid date", { postedAt: ["Enter when it was posted"] });
  if (d.getTime() > Date.now() + MAX_FUTURE_MS) {
    throw new ValidationError("A post can't be in the future.", { postedAt: ["This time is in the future"] });
  }
  return d;
}

function validUrl(platform: PostingPlatform, raw: string): string {
  const r = normalizePostUrl(platform, raw);
  if (!r.ok) throw new ValidationError(r.error, { postUrl: [r.error] });
  return r.url;
}

async function proofAsset(actor: Actor, ctx: { content: ContentDoc }, url: string | null) {
  if (!url) return null;
  const [asset] = await insertAssets([
    {
      agencyId: ctx.content.agencyId,
      brandId: ctx.content.brandId,
      kind: "POSTING_PROOF",
      storage: "EXTERNAL_LINK",
      external: { url, provider: detectAssetProvider(url), label: "Posting proof" },
      media: null,
      originalFilename: null,
      createdBy: asObjectId(actor.userId),
    },
  ]);
  return asset!._id;
}

/** READY_TO_POST → POSTED → COMPLETED once every required platform is POSTED (same transaction). */
async function completeIfAllPosted(actor: Actor, ctx: PostingContext) {
  const live = await livePostingsForVersion(ctx.content.agencyId, ctx.version._id);
  const posted = live.filter((p) => p.status === PostingStatus.POSTED).map((p) => p.platform);
  if (!allRequiredPosted(targetPlatformsOf(ctx.content), posted)) return false;
  const id = String(ctx.content._id);
  const now = new Date();
  const entity = { kind: ActivityEntityKind.CONTENT, id };
  const meta = { versionId: String(ctx.version._id), versionNumber: ctx.version.versionNumber, platforms: targetPlatformsOf(ctx.content) };

  const a = POSTING_TRANSITIONS.ALL_PLATFORMS_POSTED;
  const posted1 = await contentRepo.updateById(
    actor,
    id,
    { $set: { status: a.to, statusChangedAt: now, postedAt: now } },
    { status: { $in: a.from }, clientApprovedVersionId: ctx.version._id },
  );
  if (!posted1) throw new ConflictError("This content changed. Refresh and try again.");
  await audit(actor, ActivityAction.CONTENT_STATUS_CHANGED, entity, ctx.content.brandId, { from: ContentStatus.READY_TO_POST, to: a.to, ...meta });
  await audit(actor, ActivityAction.CONTENT_POSTED, entity, ctx.content.brandId, meta);

  const b = POSTING_TRANSITIONS.COMPLETE;
  const done = await contentRepo.updateById(
    actor,
    id,
    { $set: { status: b.to, statusChangedAt: now, completedAt: now } },
    { status: { $in: b.from } },
  );
  if (!done) throw new ConflictError("This content changed. Refresh and try again.");
  await audit(actor, ActivityAction.CONTENT_STATUS_CHANGED, entity, ctx.content.brandId, { from: ContentStatus.POSTED, to: b.to, ...meta });
  await audit(actor, ActivityAction.CONTENT_COMPLETED, entity, ctx.content.brandId, meta);
  await onContentPosted(actor, ctx.content, ctx.version);
  return true;
}

// ── Commands ─────────────────────────────────────────────────────────────

/** Uploader starts a platform (READY → POSTING). Nothing is claimed as posted. */
export async function startPosting(actor: Actor, input: StartInput): Promise<void> {
  assertCan(canProposeIdeas(actor)); // never clients
  const ctx = await loadPostingContext(actor, input.contentId, input.versionId, input.platform);
  assertIsAssignedUploader(actor, ctx.uploader);
  await withTransaction(async () => {
    await lockReadyContent(actor, ctx);
    const existing = (await livePostingsForVersion(ctx.content.agencyId, ctx.version._id)).find((p) => p.platform === input.platform);
    if (existing) {
      if (existing.status === PostingStatus.POSTED) throw new ConflictError("Already posted on this platform.");
      return; // already POSTING — idempotent
    }
    const now = new Date();
    const p = await insertPosting(baseRecord(actor, ctx, input.platform, now, PostingStatus.POSTING));
    await audit(actor, ActivityAction.POSTING_STARTED, { kind: ActivityEntityKind.POSTING, id: String(p._id) }, ctx.content.brandId, {
      contentId: input.contentId,
      platform: input.platform,
      versionNumber: ctx.version.versionNumber,
    });
  });
}

function baseRecord(
  actor: Actor,
  ctx: PostingContext,
  platform: PostingPlatform,
  now: Date,
  status: PostingStatus,
): Omit<PostingDoc, "_id" | "createdAt" | "updatedAt"> {
  return {
    agencyId: ctx.content.agencyId,
    brandId: ctx.content.brandId,
    contentId: ctx.content._id,
    contentVersionId: ctx.version._id,
    versionNumber: ctx.version.versionNumber,
    platform,
    status,
    live: true,
    postUrl: null,
    postedAt: null,
    screenshotAssetId: null,
    note: null,
    postedBy: null,
    recordedBy: null,
    source: null,
    adminReason: null,
    startedBy: asObjectId(actor.userId),
    startedAt: now,
    confirmedAt: null,
    corrections: [],
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
  };
}

/** Shared confirm path: explicit, server-side, one platform. */
async function confirm(
  actor: Actor,
  ctx: PostingContext,
  input: { platform: PostingPlatform; postUrl: string; postedAt: string | null; screenshotUrl: string | null; note: string | null },
  source: PostingSource,
  adminReason: string | null,
) {
  const postUrl = validUrl(input.platform, input.postUrl);
  const postedAt = parsePostedAt(input.postedAt);
  return withTransaction(async () => {
    await lockReadyContent(actor, ctx);
    const now = new Date();
    const screenshotAssetId = await proofAsset(actor, ctx, input.screenshotUrl);
    const confirmed = {
      status: PostingStatus.POSTED,
      postUrl,
      postedAt,
      screenshotAssetId,
      note: input.note,
      // The uploader credited is the effective uploader; an admin is only the recorder.
      postedBy: ctx.uploader.valid && ctx.uploader.userId ? asObjectId(ctx.uploader.userId) : null,
      recordedBy: asObjectId(actor.userId),
      source,
      adminReason,
      confirmedAt: now,
    };
    const existing = (await livePostingsForVersion(ctx.content.agencyId, ctx.version._id)).find((p) => p.platform === input.platform);
    let posting: PostingDoc | null;
    if (!existing) {
      posting = await insertPosting({ ...baseRecord(actor, ctx, input.platform, now, PostingStatus.POSTED), ...confirmed });
    } else if (existing.status === PostingStatus.POSTING) {
      posting = await updatePosting(ctx.content.agencyId, existing._id, { status: PostingStatus.POSTING, live: true }, { $set: confirmed });
      if (!posting) throw new ConflictError("This platform changed. Refresh and try again.");
    } else {
      throw new ConflictError("Already posted on this platform. An admin can correct the details if needed.");
    }
    const meta = {
      contentId: String(ctx.content._id),
      platform: input.platform,
      versionId: String(ctx.version._id),
      versionNumber: ctx.version.versionNumber,
      postUrl,
      source,
      postedBy: confirmed.postedBy ? String(confirmed.postedBy) : null,
      ...(adminReason ? { reason: adminReason } : {}),
    };
    await audit(
      actor,
      source === PostingSource.RECORDED_BY_ADMIN ? ActivityAction.POSTING_RECORDED_BY_ADMIN : ActivityAction.POSTING_PLATFORM_POSTED,
      { kind: ActivityEntityKind.POSTING, id: String(posting._id) },
      ctx.content.brandId,
      meta,
    );
    const completed = await completeIfAllPosted(actor, ctx);
    return { postingId: String(posting._id), completed };
  });
}

/** The assigned uploader confirms a platform post (URL + time; proof optional). */
export async function confirmPosted(actor: Actor, input: ConfirmInput) {
  assertCan(canProposeIdeas(actor));
  const ctx = await loadPostingContext(actor, input.contentId, input.versionId, input.platform);
  assertIsAssignedUploader(actor, ctx.uploader);
  return confirm(actor, ctx, input, PostingSource.UPLOADER, null);
}

/**
 * ADMIN records a post on the assigned uploader's behalf (reason required).
 * Stored as RECORDED_BY_ADMIN: postedBy stays the uploader (or null if none
 * is valid), recordedBy is the admin.
 */
export async function recordPostingOnBehalf(actor: Actor, input: OnBehalfInput) {
  assertCan(canRecordPostingOnBehalf(actor));
  const ctx = await loadPostingContext(actor, input.contentId, input.versionId, input.platform);
  return confirm(actor, ctx, input, PostingSource.RECORDED_BY_ADMIN, input.reason);
}

/** Controlled correction of a confirmed post: previous values kept, who/when/why recorded. */
export async function correctPosting(actor: Actor, input: CorrectInput): Promise<void> {
  assertCan(canCorrectPostings(actor));
  const posting = await postingsRepo.getById(actor, input.postingId); // agency scope → 404
  if (posting.status !== PostingStatus.POSTED) throw new ConflictError("Only confirmed posts can be corrected.");
  await getVisibleContent(actor, String(posting.contentId)); // content still in scope
  const postUrl = validUrl(posting.platform, input.postUrl);
  const postedAt = input.postedAt ? parsePostedAt(input.postedAt) : posting.postedAt;
  await withTransaction(async () => {
    const screenshotAssetId = input.screenshotUrl
      ? await proofAsset(actor, { content: { agencyId: posting.agencyId, brandId: posting.brandId } as ContentDoc }, input.screenshotUrl)
      : posting.screenshotAssetId;
    const now = new Date();
    const updated = await updatePosting(
      posting.agencyId,
      posting._id,
      { status: PostingStatus.POSTED, updatedAt: posting.updatedAt }, // optimistic
      {
        $set: { postUrl, postedAt, screenshotAssetId },
        $push: {
          corrections: {
            previous: { postUrl: posting.postUrl, postedAt: posting.postedAt, screenshotAssetId: posting.screenshotAssetId },
            reason: input.reason,
            correctedBy: asObjectId(actor.userId),
            correctedAt: now,
          },
        },
      },
    );
    if (!updated) throw new ConflictError("This post changed. Refresh and try again.");
    await audit(actor, ActivityAction.POSTING_CORRECTED, { kind: ActivityEntityKind.POSTING, id: String(posting._id) }, posting.brandId, {
      contentId: String(posting.contentId),
      platform: posting.platform,
      reason: input.reason,
      from: { postUrl: posting.postUrl, postedAt: posting.postedAt?.toISOString() ?? null },
      to: { postUrl, postedAt: postedAt?.toISOString() ?? null },
    });
  });
}

/**
 * Required platforms (single source of truth on the content). Editable by
 * ADMIN/MANAGER until posting starts; never emptied once the content has
 * passed internal review.
 */
export async function setTargetPlatforms(actor: Actor, input: PlatformsInput): Promise<void> {
  assertCan(canSetTargetPlatforms(actor));
  const c = await getVisibleContent(actor, input.contentId);
  if (c.archivedAt) throw new ConflictError("Archived content can't be changed.");
  if (!TARGET_PLATFORMS_EDITABLE.includes(c.status)) throw new ConflictError("Platforms can't change at this stage.");
  const pastInternal = [ContentStatus.CLIENT_REVIEW, ContentStatus.READY_TO_POST].includes(c.status as "CLIENT_REVIEW");
  if (pastInternal && input.platforms.length === 0) {
    throw new ValidationError("Choose at least one platform.", { platforms: ["At least one platform is required"] });
  }
  const before = [...targetPlatformsOf(c)].sort();
  const after = [...input.platforms].sort();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await withTransaction(async () => {
    if (c.status === ContentStatus.READY_TO_POST && c.clientApprovedVersionId) {
      const live = await livePostingsForVersion(c.agencyId, c.clientApprovedVersionId);
      if (live.length > 0) throw new ConflictError("Posting has started — platforms are locked.");
    }
    const updated = await contentRepo.updateById(actor, input.contentId, { $set: { targetPlatforms: input.platforms } }, { status: c.status, archivedAt: null });
    if (!updated) throw new ConflictError("This content changed. Refresh and try again.");
    await audit(actor, ActivityAction.CONTENT_TARGET_PLATFORMS_CHANGED, { kind: ActivityEntityKind.CONTENT, id: input.contentId }, c.brandId, {
      from: before,
      to: after,
    });
  });
}

// ── Reads ────────────────────────────────────────────────────────────────

async function peopleOf(actor: Actor, rows: PostingDoc[], extra: (Types.ObjectId | null | undefined)[] = []) {
  return peopleByIds(actor.agencyId, [
    ...rows.flatMap((r) => [r.postedBy, r.recordedBy, ...r.corrections.map((c) => c.correctedBy)]),
    ...extra,
  ]);
}

function toPostingRecordDTO(r: PostingDoc, people: Map<string, PersonRef>, proofUrls: Map<string, string>): PostingRecordDTO {
  const p = (id: Types.ObjectId | null) => (id ? (people.get(String(id)) ?? null) : null);
  return {
    id: String(r._id),
    platform: r.platform,
    status: r.status,
    versionNumber: r.versionNumber,
    postUrl: r.postUrl ?? null,
    postedAt: r.postedAt?.toISOString() ?? null,
    screenshotUrl: r.screenshotAssetId ? (proofUrls.get(String(r.screenshotAssetId)) ?? null) : null,
    note: r.note ?? null,
    postedBy: p(r.postedBy),
    recordedBy: p(r.recordedBy),
    source: r.source ?? null,
    adminReason: r.adminReason ?? null,
    startedAt: r.startedAt.toISOString(),
    corrections: r.corrections.map((c) => ({
      previousUrl: c.previous.postUrl ?? null,
      previousPostedAt: c.previous.postedAt?.toISOString() ?? null,
      reason: c.reason,
      correctedBy: p(c.correctedBy),
      correctedAt: c.correctedAt.toISOString(),
    })),
  };
}

async function proofUrlsFor(actor: Actor, rows: PostingDoc[]) {
  const ids = rows.flatMap((r) => (r.screenshotAssetId ? [r.screenshotAssetId] : []));
  const assets = await assetsByIds(actor.agencyId, ids);
  return new Map([...assets].flatMap(([id, a]) => (a.external?.url ? [[id, a.external.url] as [string, string]] : [])));
}

function platformStates(required: PostingPlatform[], live: PostingDoc[]) {
  return required.map((platform) => {
    const rec = live.find((p) => p.platform === platform);
    const state: PlatformState = !rec ? "PENDING" : rec.status === PostingStatus.POSTED ? "POSTED" : "POSTING";
    return { platform, state, rec };
  });
}

function uploaderDTO(u: UploaderResolution, people: Map<string, PersonRef>): UploaderStateDTO {
  return { source: u.source, person: u.userId ? (people.get(u.userId) ?? null) : null, valid: u.valid, problem: u.problem };
}

/**
 * The posting workspace for one content item. Visible to ADMIN/MANAGER, and
 * to the effective (valid) uploader. Everyone else: 404.
 */
export async function getPostingWorkspace(actor: Actor, contentId: string): Promise<PostingWorkspaceDTO> {
  if (actor.systemRole === SystemRole.CLIENT) throw new NotFoundError();
  const c = await getVisibleContent(actor, contentId);
  const brand = await brandsRepo.getById(actor, String(c.brandId));
  const uploader = await resolveEffectiveUploader(c.agencyId, brand, c);
  const isOps = canViewPostings(actor);
  const isUploader = uploader.valid && uploader.userId === actor.userId;
  if (!isOps && !isUploader) throw new NotFoundError();

  const postingStatuses: ContentStatus[] = [ContentStatus.READY_TO_POST, ContentStatus.POSTED, ContentStatus.COMPLETED];
  const approvedId = c.clientApprovedVersionId;
  const version = approvedId && postingStatuses.includes(c.status) ? await versionOfContent(c, approvedId) : null;
  const [history, approvalOk, clientApproval] = await Promise.all([
    postingsRepo.find(actor, { contentId: c._id }, { sort: { createdAt: -1 }, limit: 100 }),
    version ? approvalsStillHold(c.agencyId, version._id) : Promise.resolve(false),
    version
      ? approvalsRepo.find(actor, { contentVersionId: version._id, stage: "CLIENT", decision: "APPROVED" }, { limit: 1 })
      : Promise.resolve([]),
  ]);
  const live = version ? history.filter((h) => h.live && String(h.contentVersionId) === String(version._id)) : [];
  const [people, proofs, assets] = await Promise.all([
    peopleOf(actor, history, uploader.userId ? [asObjectId(uploader.userId)] : []),
    proofUrlsFor(actor, history),
    version ? assetsByIds(actor.agencyId, version.assetIds) : Promise.resolve(new Map()),
  ]);
  const states = platformStates(targetPlatformsOf(c), live);
  const platforms: PlatformRowDTO[] = states.map((s) => ({
    platform: s.platform,
    state: s.state,
    posting: s.rec ? toPostingRecordDTO(s.rec, people, proofs) : null,
  }));

  let blockedReason: string | null = null;
  if (c.status === ContentStatus.READY_TO_POST) {
    if (brand.status !== BrandStatus.ACTIVE) blockedReason = "This brand is archived — no new posting work.";
    else if (c.archivedAt) blockedReason = "This content is archived.";
    else if (!version || !approvalOk || String(c.internalApprovedVersionId) !== String(approvedId)) {
      blockedReason = "The approved version can't be verified. Ask an admin to check the approvals.";
    } else if (targetPlatformsOf(c).length === 0) blockedReason = "No platforms are set for this content.";
    else if (!uploader.valid) blockedReason = "No valid uploader is assigned. An admin or manager needs to reassign it.";
  }
  const open = c.status === ContentStatus.READY_TO_POST && !blockedReason;
  const anyLive = live.length > 0;
  const approvedVersion: ApprovedVersionDTO | null = version
    ? {
        ...(({ id, versionNumber, caption, hashtags, assets: a }) => ({ id, versionNumber, caption, hashtags, assets: a }))(
          toVersionDTO(version, assets, new Map()),
        ),
        clientApprovedAt: clientApproval[0]?.decidedAt.toISOString() ?? null,
        clientApprovalRecordedByTeam: clientApproval[0]?.source === "RECORDED_BY_ADMIN",
      }
    : null;

  return {
    content: {
      id: String(c._id),
      code: c.code,
      title: c.title,
      contentType: c.contentType,
      status: c.status,
      notes: c.notes ?? null,
      brand: { id: String(brand._id), name: brand.name, logoUrl: brand.logo?.url ?? null, archived: brand.status === BrandStatus.ARCHIVED },
    },
    targetPlatforms: targetPlatformsOf(c),
    approvedVersion,
    blockedReason,
    uploader: uploaderDTO(uploader, people),
    platforms,
    progress: { posted: states.filter((s) => s.state === "POSTED").length, required: targetPlatformsOf(c).length },
    history: history.map((h) => toPostingRecordDTO(h, people, proofs)),
    postedAt: c.postedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    canPost: open && isUploader,
    canRecordOnBehalf: open && canRecordPostingOnBehalf(actor),
    canCorrect: canCorrectPostings(actor),
    canEditPlatforms:
      canSetTargetPlatforms(actor) &&
      !c.archivedAt &&
      TARGET_PLATFORMS_EDITABLE.includes(c.status) &&
      !(c.status === ContentStatus.READY_TO_POST && anyLive),
    canReopen:
      canReopenApprovedContent(actor) && c.status === ContentStatus.READY_TO_POST && !c.archivedAt && !live.some((p) => p.status === PostingStatus.POSTED),
    canStartRevision:
      canStartRevision(actor) &&
      !c.archivedAt &&
      brand.status === BrandStatus.ACTIVE &&
      (c.status === ContentStatus.POSTED ||
        c.status === ContentStatus.COMPLETED ||
        (c.status === ContentStatus.READY_TO_POST && live.some((p) => p.status === PostingStatus.POSTED))),
    currentVersionNumber: version?.versionNumber ?? null,
    revisionCount: c.revisionCount ?? 0,
  };
}

async function queueItems(actor: Actor, docs: ContentDoc[], brands: Map<string, BrandDoc>): Promise<PostingQueueItemDTO[]> {
  const items = await Promise.all(
    docs.map(async (d) => {
      const brand = brands.get(String(d.brandId));
      if (!brand) return null;
      const [uploader, live] = await Promise.all([
        resolveEffectiveUploader(d.agencyId, brand, d),
        d.clientApprovedVersionId ? livePostingsForVersion(d.agencyId, d.clientApprovedVersionId) : Promise.resolve([]),
      ]);
      return { d, brand, uploader, live };
    }),
  );
  const ok = items.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const people = await peopleByIds(
    actor.agencyId,
    ok.map((x) => (x.uploader.userId ? asObjectId(x.uploader.userId) : null)),
  );
  return ok.map(({ d, brand, uploader, live }) => {
    const states = platformStates(targetPlatformsOf(d), live);
    return {
      id: String(d._id),
      code: d.code,
      title: d.title,
      brand: { id: String(brand._id), name: brand.name, logoUrl: brand.logo?.url ?? null },
      contentType: d.contentType,
      versionNumber: d.reviewSubmission?.versionNumber ?? null,
      targetPlatforms: targetPlatformsOf(d),
      platformStates: states.map(({ platform, state }) => ({ platform, state })),
      progress: { posted: states.filter((s) => s.state === "POSTED").length, required: targetPlatformsOf(d).length },
      readySince: (d.readyToPostAt ?? d.statusChangedAt).toISOString(),
      uploader: uploaderDTO(uploader, people),
    };
  });
}

/** The uploader's own Ready-to-Post queue (effective, valid uploader only). */
export async function listMyPostingQueue(actor: Actor): Promise<PostingQueueItemDTO[]> {
  if (!canProposeIdeas(actor)) return [];
  const me = asObjectId(actor.userId);
  const primaryBrands = await brandsRepo.find(actor, { primaryUploaderId: me, status: BrandStatus.ACTIVE }, { limit: 200 });
  const docs = await contentRepo.find(
    actor,
    {
      status: ContentStatus.READY_TO_POST,
      archivedAt: null,
      $or: [{ uploaderOverrideId: me }, { uploaderOverrideId: null, brandId: { $in: primaryBrands.map((b) => b._id) } }],
    },
    { sort: { statusChangedAt: 1 }, limit: 200 },
  );
  const brandIds = [...new Set(docs.map((d) => String(d.brandId)))];
  const brands = await brandsRepo.find(actor, { _id: { $in: brandIds.map(asObjectId) }, status: BrandStatus.ACTIVE }, { limit: 200 });
  const items = await queueItems(actor, docs, new Map(brands.map((b) => [String(b._id), b])));
  return items.filter((i) => i.uploader.valid && i.uploader.person?.id === actor.userId);
}

/** ADMIN/MANAGER: everything Ready to Post, with uploader problems surfaced. */
export async function listReadyToPost(actor: Actor, opts: { brandId?: string } = {}): Promise<PostingQueueItemDTO[]> {
  assertCan(canViewPostings(actor));
  const filter: Record<string, unknown> = { status: ContentStatus.READY_TO_POST, archivedAt: null };
  if (opts.brandId) filter.brandId = asObjectId(opts.brandId);
  const docs = await contentRepo.find(actor, filter, { sort: { statusChangedAt: 1 }, limit: 200 });
  const brands = await brandsRepo.find(actor, { _id: { $in: [...new Set(docs.map((d) => String(d.brandId)))].map(asObjectId) } }, { limit: 200 });
  return queueItems(actor, docs, new Map(brands.map((b) => [String(b._id), b])));
}

/** Confirmed posts, newest first. Ops: agency (optionally one brand). Uploaders: their own. */
export async function listPostingHistory(actor: Actor, opts: { brandId?: string; mine?: boolean } = {}): Promise<PostingHistoryItemDTO[]> {
  const filter: Record<string, unknown> = { status: PostingStatus.POSTED };
  if (opts.mine || !canViewPostings(actor)) {
    if (actor.systemRole === SystemRole.CLIENT) return [];
    filter.postedBy = asObjectId(actor.userId);
  }
  if (opts.brandId) filter.brandId = asObjectId(opts.brandId);
  const rows = await postingsRepo.find(actor, filter, { sort: { postedAt: -1 }, limit: 100 });
  if (rows.length === 0) return [];
  const [contents, people, proofs, brands] = await Promise.all([
    contentRepo.find(actor, { _id: { $in: [...new Set(rows.map((r) => String(r.contentId)))].map(asObjectId) } }, { limit: 100, projection: { code: 1, title: 1 } }),
    peopleOf(actor, rows),
    proofUrlsFor(actor, rows),
    brandSummaries(actor.agencyId, [...new Set(rows.map((r) => String(r.brandId)))].map(asObjectId)),
  ]);
  const byId = new Map(contents.map((c) => [String(c._id), c]));
  return rows.flatMap((r) => {
    const c = byId.get(String(r.contentId));
    if (!c) return [];
    return [
      {
        ...toPostingRecordDTO(r, people, proofs),
        content: { id: String(c._id), code: c.code, title: c.title },
        brand: { id: String(r.brandId), name: brands.get(String(r.brandId))?.name ?? "—" },
      },
    ];
  });
}

/** Client-safe: where the client-approved version went live. No people, notes or proof. */
export async function listClientPosts(actor: Actor, content: Pick<ContentDoc, "_id" | "clientApprovedVersionId">): Promise<ClientPostDTO[]> {
  if (!content.clientApprovedVersionId) return [];
  const rows = await postingsRepo.find(
    actor,
    { contentId: content._id, contentVersionId: content.clientApprovedVersionId, status: PostingStatus.POSTED, live: true },
    { sort: { postedAt: 1 }, limit: 20 },
  );
  return rows.flatMap((r) => (r.postUrl && r.postedAt ? [{ platform: r.platform, url: r.postUrl, postedAt: r.postedAt.toISOString() }] : []));
}
