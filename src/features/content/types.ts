import type {
  ContentOrigin,
  ContentPriority,
  ContentStatus,
  ContentType,
  ExternalAssetProvider,
  IdeaDecision,
  ProductionRoute,
  TaskSource,
  TaskStatus,
  TaskType,
} from "@/lib/domain/content";
import type { ReferencePlatform } from "@/lib/domain/references";

/**
 * Audience-specific response shapes. The server builds these from documents
 * with explicit allow-lists (src/server/dto/content.ts); raw documents never
 * reach the browser.
 */

export interface PersonRef {
  id: string;
  name: string;
  image: string | null;
}

export interface BrandRef {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface ReferenceDTO {
  id: string;
  platform: ReferencePlatform;
  url: string | null;
  externalId: string | null;
  variant: string | null;
  title: string | null;
  notes: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  canEdit: boolean;
}

export interface TaskDTO {
  id: string;
  contentId: string;
  taskType: TaskType;
  title: string;
  status: TaskStatus;
  source: TaskSource;
  /** Waiting for the content's shoot to be completed. */
  waitingOnShoot: boolean;
  assignee: PersonRef | null;
  dueDate: string | null;
  completedAt: string | null;
  isMine: boolean;
  /** Status moves this viewer may make (computed server-side). */
  allowedStatuses: TaskStatus[];
}

export interface VersionAssetDTO {
  id: string;
  kind: "EXTERNAL_LINK" | "MEDIA";
  /** External link, or a server-signed Cloudinary URL for uploaded media (authorised viewers only). */
  url: string | null;
  provider: ExternalAssetProvider | null;
  label: string | null;
  previewUrl: string | null;
  /** Uploaded media family, for inline preview (null for links). */
  mediaType: "image" | "video" | "raw" | null;
  format: string | null;
}

export interface VersionDTO {
  id: string;
  versionNumber: number;
  caption: string | null;
  hashtags: string[];
  changeNote: string | null;
  assets: VersionAssetDTO[];
  createdBy: PersonRef | null;
  createdAt: string;
}

export interface TaskSummaryDTO {
  total: number;
  done: number;
  open: number;
  unassigned: number;
}

/** Admin list row. */
export interface ContentListItemDTO {
  id: string;
  code: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  origin: ContentOrigin;
  status: ContentStatus;
  priority: ContentPriority;
  dueDate: string | null;
  updatedAt: string;
  archived: boolean;
  tasks: TaskSummaryDTO;
}

export interface ContentListData {
  items: ContentListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
  ideasPending: number;
}

export interface UploaderInfoDTO {
  /** Who receives this content when it is ready to post. */
  effective: PersonRef | null;
  source: "OVERRIDE" | "BRAND_PRIMARY" | "NONE";
  brandPrimary: PersonRef | null;
  override: PersonRef | null;
  /** Override user no longer holds an active UPLOADER membership (not auto-rewritten). */
  overrideInvalid: boolean;
}

export interface IdeaReviewDTO {
  decision: IdeaDecision;
  note: string | null;
  decidedBy: PersonRef | null;
  decidedAt: string;
}

/** Internal (admin/manager) view — everything operational. */
export interface ContentAdminDTO {
  id: string;
  code: string;
  title: string;
  description: string | null;
  notes: string | null;
  brand: BrandRef & { archived: boolean };
  contentType: ContentType;
  origin: ContentOrigin;
  status: ContentStatus;
  priority: ContentPriority;
  dueDate: string | null;
  route: ProductionRoute;
  references: ReferenceDTO[];
  tasks: TaskDTO[];
  versions: VersionDTO[];
  uploader: UploaderInfoDTO;
  ideaReview: IdeaReviewDTO | null;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * Staff view — collaboration data for their brands. No uploader-routing
 * internals, no audit data, no other people's contact details.
 */
export interface ContentStaffDTO {
  id: string;
  code: string;
  title: string;
  description: string | null;
  notes: string | null;
  brand: BrandRef;
  contentType: ContentType;
  origin: ContentOrigin;
  status: ContentStatus;
  priority: ContentPriority;
  dueDate: string | null;
  route: ProductionRoute;
  references: ReferenceDTO[];
  tasks: TaskDTO[];
  versions: VersionDTO[];
  ideaReview: { decision: IdeaDecision; note: string | null } | null;
  createdByMe: boolean;
  canEditIdea: boolean;
  canAddVersion: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Staff list row. */
export interface ContentStaffListItemDTO {
  id: string;
  code: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  status: ContentStatus;
  priority: ContentPriority;
  dueDate: string | null;
  updatedAt: string;
  myOpenTasks: number;
  ideaDecision: IdeaDecision | null;
}

/**
 * Client view — strictly client-safe. No notes, brief, tasks, people, codes,
 * routes, ideas, audit or internal status names.
 */
export interface ContentClientDTO {
  id: string;
  title: string;
  brand: BrandRef;
  contentType: ContentType;
  statusLabel: string;
  updatedAt: string;
}

/** A task in "My tasks". */
export interface MyTaskDTO {
  id: string;
  taskType: TaskType;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  allowedStatuses: TaskStatus[];
  content: {
    id: string;
    code: string;
    title: string;
    contentType: ContentType;
    status: ContentStatus;
  };
  brand: BrandRef;
}

export interface AssigneeCandidateDTO {
  id: string;
  name: string;
  image: string | null;
  brandRoles: string[];
}

/** Supervisor view of one task (ADMIN/MANAGER task board). */
export interface AdminTaskDTO {
  id: string;
  taskType: TaskType;
  title: string;
  status: TaskStatus;
  waitingOnShoot: boolean;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string } | null;
  content: { id: string; code: string; title: string; status: ContentStatus };
  brand: { id: string; name: string };
}

export interface AdminTaskBoardDTO {
  items: AdminTaskDTO[];
  counts: { open: number; inProgress: number; blocked: number; doneThisWeek: number; unassigned: number };
  truncated: boolean;
}
