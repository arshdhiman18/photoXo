import type { BrandRef, PersonRef, VersionAssetDTO } from "@/features/content/types";
import type { ContentStatus, ContentType } from "@/lib/domain/content";
import type { PlatformState, PostingPlatform, PostingSource, PostingStatus } from "@/lib/domain/postings";

export interface UploaderStateDTO {
  source: "OVERRIDE" | "BRAND_PRIMARY" | "NONE";
  person: PersonRef | null;
  valid: boolean;
  problem: "NO_UPLOADER" | "INACTIVE_ACCOUNT" | "NOT_AN_UPLOADER" | null;
}

export interface PostingCorrectionDTO {
  previousUrl: string | null;
  previousPostedAt: string | null;
  reason: string;
  correctedBy: PersonRef | null;
  correctedAt: string;
}

/** Internal posting record (ADMIN / MANAGER / the uploader). */
export interface PostingRecordDTO {
  id: string;
  platform: PostingPlatform;
  status: PostingStatus;
  versionNumber: number;
  postUrl: string | null;
  postedAt: string | null;
  screenshotUrl: string | null;
  note: string | null;
  postedBy: PersonRef | null;
  recordedBy: PersonRef | null;
  source: PostingSource | null;
  adminReason: string | null;
  startedAt: string;
  corrections: PostingCorrectionDTO[];
}

export interface PlatformRowDTO {
  platform: PostingPlatform;
  state: PlatformState;
  posting: PostingRecordDTO | null;
}

/** The exact version to post: always the client-approved version. */
export interface ApprovedVersionDTO {
  id: string;
  versionNumber: number;
  caption: string | null;
  hashtags: string[];
  assets: VersionAssetDTO[];
  clientApprovedAt: string | null;
  clientApprovalRecordedByTeam: boolean;
}

/** Posting workspace for one content item (uploader page + admin panel). */
export interface PostingWorkspaceDTO {
  content: {
    id: string;
    code: string;
    title: string;
    contentType: ContentType;
    status: ContentStatus;
    notes: string | null;
    brand: BrandRef & { archived: boolean };
  };
  targetPlatforms: PostingPlatform[];
  approvedVersion: ApprovedVersionDTO | null;
  /** Why posting is blocked (approval integrity, archived brand, …), if it is. */
  blockedReason: string | null;
  uploader: UploaderStateDTO;
  platforms: PlatformRowDTO[];
  progress: { posted: number; required: number };
  /** All records incl. cancelled ones and other versions (history), newest first. */
  history: PostingRecordDTO[];
  postedAt: string | null;
  completedAt: string | null;
  canPost: boolean;
  canRecordOnBehalf: boolean;
  canCorrect: boolean;
  canEditPlatforms: boolean;
  canReopen: boolean;
  /** Post-publication revision possible (posted/completed, or partly posted). */
  canStartRevision: boolean;
  /** Version currently in the posting round (null between rounds). */
  currentVersionNumber: number | null;
  revisionCount: number;
}

export interface PostingQueueItemDTO {
  id: string;
  code: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  versionNumber: number | null;
  targetPlatforms: PostingPlatform[];
  platformStates: { platform: PostingPlatform; state: PlatformState }[];
  progress: { posted: number; required: number };
  readySince: string;
  uploader: UploaderStateDTO;
}

export interface PostingHistoryItemDTO extends PostingRecordDTO {
  content: { id: string; code: string; title: string };
  brand: { id: string; name: string };
}

/** What a client may see about posts: where it went live, nothing internal. */
export interface ClientPostDTO {
  platform: PostingPlatform;
  url: string;
  postedAt: string;
}
