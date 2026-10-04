/**
 * Approval domain — gates, decisions and the approval state machine.
 *
 * Approval is a workflow GATE between production and (future) posting, never
 * completion: the furthest an approval can move content is READY_TO_POST.
 */
import { ContentStatus, ReviewGate } from "./content";

export const ApprovalStage = ReviewGate;
export type ApprovalStage = ReviewGate;
export const APPROVAL_STAGES = Object.values(ApprovalStage);

export const ApprovalDecision = {
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];
export const APPROVAL_DECISIONS = Object.values(ApprovalDecision);

/**
 * Who actually made the decision:
 *  · REVIEWER          — an ADMIN/MANAGER deciding the INTERNAL gate
 *  · CLIENT_USER       — the client personally, in the portal
 *  · RECORDED_BY_ADMIN — an ADMIN recording a client decision given outside
 *                        the portal (e.g. WhatsApp). Never shown as the client.
 */
export const ApprovalSource = {
  REVIEWER: "REVIEWER",
  CLIENT_USER: "CLIENT_USER",
  RECORDED_BY_ADMIN: "RECORDED_BY_ADMIN",
} as const;
export type ApprovalSource = (typeof ApprovalSource)[keyof typeof ApprovalSource];
export const APPROVAL_SOURCES = Object.values(ApprovalSource);

/** Who may read an approval comment. Decided when the record is written, never later. */
export const CommentVisibility = { INTERNAL: "INTERNAL", CLIENT: "CLIENT" } as const;
export type CommentVisibility = (typeof CommentVisibility)[keyof typeof CommentVisibility];

/**
 * INTERNAL-gate comments are internal. A client's own comment is client-facing.
 * An admin's note when recording a client decision is internal (it explains
 * the out-of-band evidence, e.g. "approved on WhatsApp 3 Oct").
 */
export function commentVisibilityFor(stage: ApprovalStage, source: ApprovalSource): CommentVisibility {
  return stage === ApprovalStage.CLIENT && source === ApprovalSource.CLIENT_USER
    ? CommentVisibility.CLIENT
    : CommentVisibility.INTERNAL;
}

/** The review status that corresponds to each gate. */
export const REVIEW_STATUS: Record<ApprovalStage, ContentStatus> = {
  INTERNAL: ContentStatus.INTERNAL_REVIEW,
  CLIENT: ContentStatus.CLIENT_REVIEW,
};

/**
 * The approval state machine — the ONLY way content enters or leaves review.
 * Performed exclusively by the approval service, in the same transaction as
 * the approval record (or submission) that justifies the move.
 */
export const ApprovalEvent = {
  SUBMIT_INTERNAL: "SUBMIT_INTERNAL",
  INTERNAL_APPROVED: "INTERNAL_APPROVED",
  INTERNAL_CHANGES_REQUESTED: "INTERNAL_CHANGES_REQUESTED",
  CLIENT_APPROVED: "CLIENT_APPROVED",
  CLIENT_CHANGES_REQUESTED: "CLIENT_CHANGES_REQUESTED",
  /** ADMIN/MANAGER send approved content back for changes BEFORE anything is posted. */
  REOPEN_FOR_CHANGES: "REOPEN_FOR_CHANGES",
  /**
   * ADMIN/MANAGER start a new revision of content that has already been
   * (partly) posted. The posted version and its postings stay historical; a
   * new version must pass internal + client review and its own posting round.
   */
  START_REVISION: "START_REVISION",
} as const;
export type ApprovalEvent = (typeof ApprovalEvent)[keyof typeof ApprovalEvent];

export const APPROVAL_TRANSITIONS: Record<ApprovalEvent, { from: ContentStatus[]; to: ContentStatus }> = {
  // A new version (V1, or V2 after changes) always starts at the INTERNAL gate.
  SUBMIT_INTERNAL: { from: ["IN_PRODUCTION", "CHANGES_REQUESTED"], to: "INTERNAL_REVIEW" },
  INTERNAL_APPROVED: { from: ["INTERNAL_REVIEW"], to: "CLIENT_REVIEW" },
  INTERNAL_CHANGES_REQUESTED: { from: ["INTERNAL_REVIEW"], to: "CHANGES_REQUESTED" },
  CLIENT_APPROVED: { from: ["CLIENT_REVIEW"], to: "READY_TO_POST" },
  CLIENT_CHANGES_REQUESTED: { from: ["CLIENT_REVIEW"], to: "CHANGES_REQUESTED" },
  REOPEN_FOR_CHANGES: { from: ["READY_TO_POST"], to: "CHANGES_REQUESTED" },
  // READY_TO_POST only when at least one platform is already POSTED (checked by the service).
  START_REVISION: { from: ["POSTED", "COMPLETED", "READY_TO_POST"], to: "CHANGES_REQUESTED" },
};

export function approvalEventFor(stage: ApprovalStage, decision: ApprovalDecision): ApprovalEvent {
  if (stage === ApprovalStage.INTERNAL) {
    return decision === ApprovalDecision.APPROVED
      ? ApprovalEvent.INTERNAL_APPROVED
      : ApprovalEvent.INTERNAL_CHANGES_REQUESTED;
  }
  return decision === ApprovalDecision.APPROVED
    ? ApprovalEvent.CLIENT_APPROVED
    : ApprovalEvent.CLIENT_CHANGES_REQUESTED;
}

export function canApplyApprovalEvent(from: ContentStatus, event: ApprovalEvent): boolean {
  return APPROVAL_TRANSITIONS[event].from.includes(from);
}

export const APPROVAL_STAGE_LABEL: Record<ApprovalStage, string> = {
  INTERNAL: "Internal review",
  CLIENT: "Client review",
};
export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
};

export const APPROVAL_COMMENT_MAX = 2000;
