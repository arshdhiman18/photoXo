import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import {
  CONTENT_ORIGINS,
  CONTENT_PRIORITIES,
  CONTENT_STATUSES,
  CONTENT_TYPE_KEYS,
  PRODUCTION_ROUTES,
  type ContentOrigin,
  type ContentPriority,
  type ContentStatus,
  type ContentType,
  type IdeaDecision,
  type ProductionRoute,
} from "@/lib/domain/content";
import type { ApprovalSource, ApprovalStage } from "@/lib/domain/approvals";
import { POSTING_PLATFORMS, type PostingPlatform } from "@/lib/domain/postings";
import { defineModel } from "./define";

/** The latest change request (who / when / which version / why). History lives in `approvals`. */
export interface ChangeRequestInfo {
  stage: ApprovalStage;
  source: ApprovalSource;
  /** The approval record behind it; null when it was opened as a post-publication revision. */
  approvalId: Types.ObjectId | null;
  /** Set when this change request opened post-publication revision N. */
  revision?: number | null;
  versionId: Types.ObjectId;
  versionNumber: number;
  comment: string;
  decidedBy: Types.ObjectId;
  decidedAt: Date;
}

/** One post-publication revision cycle (append-only; earlier cycles stay auditable). */
export interface RevisionInfo {
  number: number;
  reason: string;
  startedBy: Types.ObjectId;
  startedAt: Date;
  /** The client-approved version that had been (partly) posted — stays historical. */
  fromVersionId: Types.ObjectId;
  fromVersionNumber: number;
  previousStatus: ContentStatus;
  previousPostedAt: Date | null;
  previousCompletedAt: Date | null;
}

/** The exact version currently (or last) submitted for review. */
export interface ReviewSubmission {
  versionId: Types.ObjectId;
  versionNumber: number;
  submittedBy: Types.ObjectId;
  submittedAt: Date;
}

/**
 * The central production object: one deliverable for one brand.
 * Workflow fields for approvals and posting live on the document so
 * those stages extend rather than migrate the model.
 */
export interface ContentDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  /** Human code, e.g. MAM-0142 — unique per agency. Never the primary key. */
  code: string;
  title: string;
  /** The brief / idea description (internal). */
  description: string | null;
  /** Internal production notes — never client-visible. */
  notes: string | null;
  contentType: ContentType;
  origin: ContentOrigin;
  status: ContentStatus;
  priority: ContentPriority;
  dueDate: Date | null;
  route: ProductionRoute;
  /** Brand-scoped references (optional; ideas need none). */
  referenceIds: Types.ObjectId[];
  /** Exception to Brand.primaryUploaderId. Must be an active UPLOADER on the brand when set. */
  uploaderOverrideId: Types.ObjectId | null;
  /**
   * The ACTIVE shoot this content is attached to (lock enforcing "at most one
   * active shoot"). Shoot.contentIds is the source of truth; maintained only
   * by the shoot service, in the same transaction.
   */
  activeShootId: Types.ObjectId | null;
  ideaReview: {
    decision: IdeaDecision;
    note: string | null;
    decidedBy: Types.ObjectId;
    decidedAt: Date;
  } | null;
  /** Monotonic version counter; ContentVersion numbers are allocated from it. */
  versionCount: number;
  currentVersionId: Types.ObjectId | null;
  // ── Approval workflow (Stage 5). Written ONLY by the approval service, in
  // the same transaction as the approval record; `approvals` is the source of
  // truth, these are the current-cycle pointers used for gating and queues.
  /** The version under review. The browser's versionId must match it. */
  reviewSubmission: ReviewSubmission | null;
  /** Version that passed the INTERNAL gate in the current review cycle (cleared on resubmission). */
  internalApprovedVersionId: Types.ObjectId | null;
  /** Version that passed the CLIENT gate (→ READY_TO_POST). Cleared on resubmission. */
  clientApprovedVersionId: Types.ObjectId | null;
  /** Latest change request; kept as context until the next one replaces it. */
  changesRequestedBy: ChangeRequestInfo | null;
  /**
   * The client should see "Changes in progress" until the revision reaches them:
   * set when the client asks for changes, or when already client-approved content
   * is sent back for changes before posting.
   */
  clientChangesPending: boolean;
  readyToPostAt: Date | null;
  // ── Posting (Stage 6) ──
  /**
   * The platforms this content MUST be posted to (single source of truth).
   * Set by ADMIN/MANAGER; required before internal approval; locked once
   * posting has started. Never chosen by the uploader at posting time.
   */
  targetPlatforms: PostingPlatform[];
  postedAt: Date | null;
  completedAt: Date | null;
  /** Post-publication revisions started so far (0 = original cycle). */
  revisionCount: number;
  revisions: RevisionInfo[];
  statusChangedAt: Date;
  cancelledAt: Date | null;
  archivedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const contentSchema = new Schema<ContentDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    code: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: null, maxlength: 5000 },
    notes: { type: String, default: null, maxlength: 5000 },
    contentType: { type: String, enum: CONTENT_TYPE_KEYS, required: true },
    origin: { type: String, enum: CONTENT_ORIGINS, required: true },
    status: { type: String, enum: CONTENT_STATUSES, required: true },
    priority: { type: String, enum: CONTENT_PRIORITIES, required: true, default: "NORMAL" },
    dueDate: { type: Date, default: null },
    route: { type: String, enum: PRODUCTION_ROUTES, required: true },
    referenceIds: { type: [Schema.Types.ObjectId], ref: "Reference", default: [] },
    uploaderOverrideId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    activeShootId: { type: Schema.Types.ObjectId, ref: "Shoot", default: null },
    ideaReview: {
      type: new Schema(
        {
          decision: { type: String, required: true },
          note: { type: String, default: null, maxlength: 1000 },
          decidedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          decidedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    versionCount: { type: Number, required: true, default: 0, min: 0 },
    currentVersionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", default: null },
    reviewSubmission: {
      type: new Schema(
        {
          versionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", required: true },
          versionNumber: { type: Number, required: true },
          submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          submittedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    internalApprovedVersionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", default: null },
    clientApprovedVersionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", default: null },
    changesRequestedBy: {
      type: new Schema(
        {
          stage: { type: String, enum: ["INTERNAL", "CLIENT"], required: true },
          source: { type: String, required: true },
          approvalId: { type: Schema.Types.ObjectId, ref: "Approval", default: null },
          revision: { type: Number, default: null },
          versionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", required: true },
          versionNumber: { type: Number, required: true },
          comment: { type: String, required: true, maxlength: 2000 },
          decidedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          decidedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    clientChangesPending: { type: Boolean, required: true, default: false },
    readyToPostAt: { type: Date, default: null },
    targetPlatforms: { type: [{ type: String, enum: POSTING_PLATFORMS }], default: [] },
    postedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    revisionCount: { type: Number, required: true, default: 0, min: 0 },
    revisions: {
      type: [
        new Schema(
          {
            number: { type: Number, required: true },
            reason: { type: String, required: true, maxlength: 1000 },
            startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
            startedAt: { type: Date, required: true },
            fromVersionId: { type: Schema.Types.ObjectId, ref: "ContentVersion", required: true },
            fromVersionNumber: { type: Number, required: true },
            previousStatus: { type: String, required: true },
            previousPostedAt: { type: Date, default: null },
            previousCompletedAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    statusChangedAt: { type: Date, required: true },
    cancelledAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "contents" },
);

contentSchema.index({ agencyId: 1, code: 1 }, { unique: true });
contentSchema.index({ agencyId: 1, brandId: 1, status: 1, updatedAt: -1 });
contentSchema.index({ agencyId: 1, brandId: 1, createdAt: -1 });
contentSchema.index({ agencyId: 1, status: 1, updatedAt: -1 });
// Review queues: oldest-waiting first (internal queue, client-review visibility, changes requested).
contentSchema.index({ agencyId: 1, status: 1, statusChangedAt: 1 });
// Ready-to-Post queues: per-content uploader override (uploader queue) …
contentSchema.index(
  { agencyId: 1, uploaderOverrideId: 1, status: 1 },
  { partialFilterExpression: { uploaderOverrideId: { $type: "objectId" } }, name: "uploader_override_status" },
);
// Overdue-content reminder scan.
contentSchema.index({ agencyId: 1, dueDate: 1 }, { partialFilterExpression: { dueDate: { $type: "date" } } });
// Client approval inbox / brand approvals: per brand, by status, oldest-waiting first.
contentSchema.index({ agencyId: 1, brandId: 1, status: 1, statusChangedAt: 1 });
contentSchema.index({ agencyId: 1, createdBy: 1, createdAt: -1 });


export const ContentModel: Model<ContentDoc> = defineModel<ContentDoc>("Content", contentSchema);
