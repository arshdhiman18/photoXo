import type {
  ApprovalDecision,
  ApprovalSource,
  ApprovalStage,
  CommentVisibility,
} from "@/lib/domain/approvals";
import type { ContentStatus, ContentType, ReviewGate } from "@/lib/domain/content";
import type { BrandRef, PersonRef, VersionAssetDTO } from "@/features/content/types";
import type { ClientPostDTO } from "@/features/postings/types";

/** One decision in the internal timeline (ADMIN / MANAGER / STAFF). */
export interface ApprovalRecordDTO {
  id: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  source: ApprovalSource;
  comment: string | null;
  commentVisibility: CommentVisibility;
  version: { id: string; number: number };
  decidedBy: PersonRef | null;
  decidedAt: string;
}

export interface ChangeRequestDTO {
  /** Set when this opened post-publication revision N. */
  revision: number | null;
  stage: ApprovalStage;
  source: ApprovalSource;
  versionNumber: number;
  comment: string;
  decidedBy: PersonRef | null;
  decidedAt: string;
}

/** Review state of one content item for internal users (server-computed capabilities). */
export interface ReviewStateDTO {
  contentId: string;
  status: ContentStatus;
  gates: ReviewGate[];
  /** The exact version currently in INTERNAL_REVIEW / CLIENT_REVIEW. */
  underReview: {
    versionId: string;
    versionNumber: number;
    submittedBy: PersonRef | null;
    submittedAt: string;
  } | null;
  internalApprovedVersionNumber: number | null;
  clientApprovedVersionNumber: number | null;
  /** Latest change request (context for the next version). */
  changeRequest: ChangeRequestDTO | null;
  history: ApprovalRecordDTO[];
  /** Post-publication revision cycles (newest first); earlier cycles stay historical. */
  revisions: {
    number: number;
    reason: string;
    startedBy: PersonRef | null;
    startedAt: string;
    fromVersionNumber: number;
    previousStatus: ContentStatus;
  }[];
  /** The version the viewer may submit for internal review now (null = not allowed). */
  canSubmit: { versionId: string; versionNumber: number } | null;
  /** Why submission is not possible right now (shown to people who could otherwise submit). */
  submitHint: string | null;
  canDecideInternal: boolean;
  canRecordClientApproval: boolean;
}

/** Row in the internal review queues. */
export interface ReviewQueueItemDTO {
  id: string;
  code: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  status: ContentStatus;
  versionNumber: number | null;
  waitingSince: string;
  changeRequest: Pick<ChangeRequestDTO, "stage" | "source" | "comment" | "versionNumber"> | null;
}

export interface ReviewQueuesDTO {
  internal: ReviewQueueItemDTO[];
  client: ReviewQueueItemDTO[];
  changes: ReviewQueueItemDTO[];
}

export interface RecentDecisionDTO extends ApprovalRecordDTO {
  content: { id: string; code: string; title: string };
  brand: { id: string; name: string };
}

// ── Client audience ──────────────────────────────────────────────────────

/** Where an item sits in the client's inbox. Never reveals internal stages. */
export type ClientApprovalState = "AWAITING" | "CHANGES" | "APPROVED";

export interface ClientApprovalItemDTO {
  id: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  state: ClientApprovalState;
  statusLabel: string;
  since: string;
}

export interface ClientApprovalInboxDTO {
  awaiting: ClientApprovalItemDTO[];
  changes: ClientApprovalItemDTO[];
  approved: ClientApprovalItemDTO[];
}

/** Client-facing history entry: CLIENT-gate decisions only, client-visible comments only. */
export interface ClientApprovalRecordDTO {
  id: string;
  decision: ApprovalDecision;
  versionNumber: number;
  /** "You", another client user's name, or "Your PhotoXo team (recorded on your behalf)". */
  byLabel: string;
  recordedByTeam: boolean;
  comment: string | null;
  decidedAt: string;
}

/** What the client is approving: media + caption + hashtags of one exact version. */
export interface ClientVersionDTO {
  id: string;
  versionNumber: number;
  caption: string | null;
  hashtags: string[];
  assets: Pick<VersionAssetDTO, "id" | "kind" | "url" | "provider" | "label" | "previewUrl" | "mediaType" | "format">[];
}

export interface ClientReviewDTO {
  id: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  state: ClientApprovalState;
  statusLabel: string;
  version: ClientVersionDTO | null;
  canDecide: boolean;
  history: ClientApprovalRecordDTO[];
  /** Where the approved version went live (client-safe: platform, public URL, time). */
  posts: ClientPostDTO[];
}
