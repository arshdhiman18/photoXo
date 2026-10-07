/**
 * Content domain — the single source of truth for content types, origins,
 * lifecycle, production routes and production tasks. UI and services read
 * these definitions; nothing branches on individual literals elsewhere.
 */
import { BrandRole } from "./roles";

// ── Content types (extensible config) ──────────────────────────────────────

export const ProductionRoute = {
  SHOOT_AND_EDIT: "SHOOT_AND_EDIT",
  SHOOT_THEN_EDIT: "SHOOT_THEN_EDIT",
  DESIGN: "DESIGN",
  EXISTING_ASSET: "EXISTING_ASSET",
} as const;
export type ProductionRoute = (typeof ProductionRoute)[keyof typeof ProductionRoute];
export const PRODUCTION_ROUTES = Object.values(ProductionRoute);

export interface ContentTypeDef {
  label: string;
  /** Short singular/plural for summaries like "3 Reels + 5 Photos". */
  short: [string, string];
  /** Route preselected when creating content of this type (changeable). */
  defaultRoute: ProductionRoute;
  /** Media family, for future preview/upload behaviour. */
  media: "video" | "image" | "mixed";
}

export const CONTENT_TYPES = {
  REEL: { label: "Reel", short: ["Reel", "Reels"], defaultRoute: "SHOOT_AND_EDIT", media: "video" },
  VIDEO: { label: "Video", short: ["Video", "Videos"], defaultRoute: "SHOOT_THEN_EDIT", media: "video" },
  PHOTOGRAPHY: { label: "Photography", short: ["Photo set", "Photo sets"], defaultRoute: "SHOOT_AND_EDIT", media: "image" },
  GRAPHIC: { label: "Graphic design", short: ["Graphic", "Graphics"], defaultRoute: "DESIGN", media: "image" },
  STORY: { label: "Story", short: ["Story", "Stories"], defaultRoute: "DESIGN", media: "mixed" },
  CAROUSEL: { label: "Carousel", short: ["Carousel", "Carousels"], defaultRoute: "DESIGN", media: "image" },
  SOCIAL_POST: { label: "Social post", short: ["Post", "Posts"], defaultRoute: "DESIGN", media: "mixed" },
  ADVERTISEMENT: { label: "Advertisement", short: ["Ad", "Ads"], defaultRoute: "SHOOT_THEN_EDIT", media: "mixed" },
  OTHER: { label: "Other", short: ["Other", "Others"], defaultRoute: "EXISTING_ASSET", media: "mixed" },
} as const satisfies Record<string, ContentTypeDef>;
export type ContentType = keyof typeof CONTENT_TYPES;

/** "3 Reels + 1 Photo set" from a list of content types (stable config order). */
export function summarizeContentTypes(types: ContentType[]): string {
  if (types.length === 0) return "No content yet";
  const counts = new Map<ContentType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return (Object.keys(CONTENT_TYPES) as ContentType[])
    .filter((t) => counts.has(t))
    .map((t) => {
      const n = counts.get(t)!;
      return `${n} ${CONTENT_TYPES[t].short[n === 1 ? 0 : 1]}`;
    })
    .join(" + ");
}
export const CONTENT_TYPE_KEYS = Object.keys(CONTENT_TYPES) as ContentType[];

// ── Origins ────────────────────────────────────────────────────────────────

export const ContentOrigin = {
  ADMIN_BRIEF: "ADMIN_BRIEF",
  REFERENCE: "REFERENCE",
  TEAM_IDEA: "TEAM_IDEA",
} as const;
export type ContentOrigin = (typeof ContentOrigin)[keyof typeof ContentOrigin];
export const CONTENT_ORIGINS = Object.values(ContentOrigin);
export const CONTENT_ORIGIN_LABEL: Record<ContentOrigin, string> = {
  ADMIN_BRIEF: "Brief",
  REFERENCE: "From reference",
  TEAM_IDEA: "Team idea",
};

// ── Lifecycle ──────────────────────────────────────────────────────────────

export const ContentStatus = {
  PROPOSED: "PROPOSED",
  PLANNED: "PLANNED",
  IN_PRODUCTION: "IN_PRODUCTION",
  INTERNAL_REVIEW: "INTERNAL_REVIEW",
  CLIENT_REVIEW: "CLIENT_REVIEW",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  READY_TO_POST: "READY_TO_POST",
  POSTED: "POSTED",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];
export const CONTENT_STATUSES = Object.values(ContentStatus);

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  PROPOSED: "Idea · proposed",
  PLANNED: "Planned",
  IN_PRODUCTION: "In production",
  INTERNAL_REVIEW: "Internal review",
  CLIENT_REVIEW: "Client review",
  CHANGES_REQUESTED: "Changes requested",
  READY_TO_POST: "Ready to post",
  POSTED: "Posted",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const CONTENT_STATUS_TONE: Record<
  ContentStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  PROPOSED: "warning",
  PLANNED: "neutral",
  IN_PRODUCTION: "info",
  INTERNAL_REVIEW: "info",
  CLIENT_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  READY_TO_POST: "success",
  POSTED: "success",
  COMPLETED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

/**
 * GENERAL status transitions (planning, production start, cancellation),
 * performed by the content workflow (`transitionContent`). Review/approval
 * moves are deliberately NOT here: they live in `APPROVAL_TRANSITIONS`
 * (src/lib/domain/approvals.ts) and only the approval service performs them,
 * together with the approval record that justifies them. Posting and
 * completion are only reachable through the posting service (POSTING_TRANSITIONS).
 */
export const CONTENT_TRANSITIONS: Partial<Record<ContentStatus, ContentStatus[]>> = {
  PROPOSED: ["PLANNED", "REJECTED", "CANCELLED"], // idea decision / withdraw
  PLANNED: ["IN_PRODUCTION", "CANCELLED"], // first task started or version added
  IN_PRODUCTION: ["CANCELLED"],
  INTERNAL_REVIEW: ["CANCELLED"],
  CLIENT_REVIEW: ["CANCELLED"],
  CHANGES_REQUESTED: ["CANCELLED"],
  READY_TO_POST: ["CANCELLED"],
};
export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return CONTENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Content may be archived only once it is finished one way or another. */
export const ARCHIVABLE_STATUSES: ContentStatus[] = ["COMPLETED", "REJECTED", "CANCELLED"];
/** Content in these states accepts production work (tasks, versions). */
export const PRODUCTION_STATUSES: ContentStatus[] = [
  "PLANNED",
  "IN_PRODUCTION",
  "CHANGES_REQUESTED",
];
/** Statuses where the route may still change (no production started). */
export const ROUTE_EDITABLE_STATUSES: ContentStatus[] = ["PROPOSED", "PLANNED"];

/**
 * What clients may see. Only reviewable/finished work — never ideas,
 * planning or production. Additionally, while the team works on changes the
 * CLIENT asked for (`Content.clientChangesPending`), the item stays visible to
 * the client as "Changes in progress" (CHANGES_REQUESTED / INTERNAL_REVIEW),
 * without revealing which internal stage it is in.
 */
export const CLIENT_VISIBLE_STATUSES: ContentStatus[] = [
  "CLIENT_REVIEW",
  "READY_TO_POST",
  "POSTED",
  "COMPLETED",
];

/** Client-facing wording (no internal production detail). */
export const CLIENT_STATUS_LABEL: Partial<Record<ContentStatus, string>> = {
  CLIENT_REVIEW: "Awaiting your approval",
  CHANGES_REQUESTED: "Changes in progress",
  READY_TO_POST: "Approved",
  POSTED: "Published",
  COMPLETED: "Published",
};

/** Statuses in which a client-requested revision is still being worked on internally. */
export const CLIENT_CHANGES_IN_PROGRESS_STATUSES: ContentStatus[] = [
  "CHANGES_REQUESTED",
  "INTERNAL_REVIEW",
];

/** The two approval gates. A route's REVIEW step lists which gates it requires. */
export const ReviewGate = { INTERNAL: "INTERNAL", CLIENT: "CLIENT" } as const;
export type ReviewGate = (typeof ReviewGate)[keyof typeof ReviewGate];

// ── Priority ───────────────────────────────────────────────────────────────

export const ContentPriority = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type ContentPriority = (typeof ContentPriority)[keyof typeof ContentPriority];
export const CONTENT_PRIORITIES = Object.values(ContentPriority);
export const CONTENT_PRIORITY_LABEL: Record<ContentPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

// ── Ideas ──────────────────────────────────────────────────────────────────

/** Lightweight planning decision on a TEAM_IDEA — NOT the content approval gates. */
export const IdeaDecision = {
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
} as const;
export type IdeaDecision = (typeof IdeaDecision)[keyof typeof IdeaDecision];

// ── Production tasks ───────────────────────────────────────────────────────

export const TaskType = {
  CREATE: "CREATE",
  UPLOAD_RAW: "UPLOAD_RAW",
  EDIT: "EDIT",
  DESIGN: "DESIGN",
  UPLOAD_FINAL: "UPLOAD_FINAL",
  OTHER: "OTHER",
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];
export const TASK_TYPES = Object.values(TaskType);

const PRODUCTION_BRAND_ROLES: BrandRole[] = [
  BrandRole.VIDEOGRAPHER,
  BrandRole.PHOTOGRAPHER,
  BrandRole.CONTENT_CREATOR,
  BrandRole.EDITOR,
  BrandRole.DESIGNER,
  BrandRole.ASSISTANT,
  BrandRole.OTHER_PRODUCTION,
];

export interface TaskTypeDef {
  label: string;
  /** Brand roles that qualify someone for this task on the content's brand. */
  eligibleBrandRoles: BrandRole[];
  /** Whether completing this task normally involves submitting a version. */
  producesVersion: boolean;
}

export const TASK_TYPE_DEFS: Record<TaskType, TaskTypeDef> = {
  CREATE: {
    label: "Create",
    eligibleBrandRoles: [...PRODUCTION_BRAND_ROLES, BrandRole.BRAND_MANAGER],
    producesVersion: true,
  },
  UPLOAD_RAW: {
    label: "Upload raw footage",
    eligibleBrandRoles: [
      BrandRole.VIDEOGRAPHER,
      BrandRole.PHOTOGRAPHER,
      BrandRole.ASSISTANT,
      BrandRole.OTHER_PRODUCTION,
    ],
    producesVersion: false,
  },
  EDIT: {
    label: "Edit",
    eligibleBrandRoles: [BrandRole.EDITOR, BrandRole.VIDEOGRAPHER, BrandRole.OTHER_PRODUCTION],
    producesVersion: true,
  },
  DESIGN: {
    label: "Design",
    eligibleBrandRoles: [BrandRole.DESIGNER, BrandRole.OTHER_PRODUCTION],
    producesVersion: true,
  },
  UPLOAD_FINAL: {
    label: "Upload final creation",
    eligibleBrandRoles: [
      BrandRole.VIDEOGRAPHER,
      BrandRole.PHOTOGRAPHER,
      BrandRole.EDITOR,
      BrandRole.DESIGNER,
      BrandRole.OTHER_PRODUCTION,
    ],
    producesVersion: true,
  },
  OTHER: {
    label: "Other",
    eligibleBrandRoles: [...PRODUCTION_BRAND_ROLES, BrandRole.BRAND_MANAGER],
    producesVersion: false,
  },
};

/** Task types whose assignee may submit content versions. */
export const VERSION_TASK_TYPES = (Object.keys(TASK_TYPE_DEFS) as TaskType[]).filter(
  (t) => TASK_TYPE_DEFS[t].producesVersion,
);

export const TaskStatus = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus);
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Done",
  CANCELLED: "Cancelled",
};
export const OPEN_TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED"];

/** Status moves an ASSIGNEE may make on their own task (cancel is managers only). */
export const ASSIGNEE_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "BLOCKED"],
  IN_PROGRESS: ["TODO", "BLOCKED", "COMPLETED"],
  BLOCKED: ["TODO", "IN_PROGRESS"],
  COMPLETED: ["IN_PROGRESS"], // reopen if completed by mistake
  CANCELLED: [],
};

/**
 * Statuses a supervisor (ADMIN/MANAGER) may set on someone else's task. They
 * assign, unblock, block and remove work; starting and completing it is the
 * assignee's job, so progress always reflects what the person actually did.
 */
export const SUPERVISOR_TASK_STATUSES: TaskStatus[] = ["TODO", "BLOCKED", "CANCELLED"];

export const TaskSource = { ROUTE: "ROUTE", MANUAL: "MANUAL" } as const;
export type TaskSource = (typeof TaskSource)[keyof typeof TaskSource];

// ── Production routes (central configuration) ──────────────────────────────

/**
 * A route is an ordered list of steps. TASK steps generate production tasks
 * when content becomes PLANNED. SHOOT steps are fulfilled by the future Shoot
 * entity (Stage 4) — they never create tasks. REVIEW is the approval gate
 * (Stage 5): `gates` lists the reviews the content must pass, in order.
 */
export type RouteStep =
  | { kind: "SHOOT"; label: string }
  | { kind: "TASK"; taskType: TaskType; label: string }
  | { kind: "REVIEW"; label: string; gates: ReviewGate[] };

export interface RouteDef {
  label: string;
  description: string;
  steps: RouteStep[];
}

export const PRODUCTION_ROUTE_DEFS: Record<ProductionRoute, RouteDef> = {
  SHOOT_AND_EDIT: {
    label: "Shoot & edit",
    description: "The same person shoots and edits, then uploads the creation.",
    steps: [
      { kind: "SHOOT", label: "Shoot" },
      { kind: "TASK", taskType: "UPLOAD_FINAL", label: "Edit & upload creation" },
      { kind: "REVIEW", label: "Review", gates: ["INTERNAL", "CLIENT"] },
    ],
  },
  SHOOT_THEN_EDIT: {
    label: "Shoot, then editor",
    description: "Raw footage is handed to an editor who delivers the creation.",
    steps: [
      { kind: "SHOOT", label: "Shoot" },
      { kind: "TASK", taskType: "UPLOAD_RAW", label: "Upload raw footage" },
      { kind: "TASK", taskType: "EDIT", label: "Edit & upload creation" },
      { kind: "REVIEW", label: "Review", gates: ["INTERNAL", "CLIENT"] },
    ],
  },
  DESIGN: {
    label: "Design",
    description: "A designer creates the asset — no shoot.",
    steps: [
      { kind: "TASK", taskType: "DESIGN", label: "Design & upload" },
      { kind: "REVIEW", label: "Review", gates: ["INTERNAL", "CLIENT"] },
    ],
  },
  EXISTING_ASSET: {
    label: "Existing asset",
    description: "An existing asset is uploaded for review — no production.",
    steps: [
      { kind: "TASK", taskType: "UPLOAD_FINAL", label: "Upload existing asset" },
      { kind: "REVIEW", label: "Review", gates: ["INTERNAL", "CLIENT"] },
    ],
  },
};

/** The review gates the route requires (empty when the route has no REVIEW step). */
export function routeReviewGates(route: ProductionRoute): ReviewGate[] {
  const step = PRODUCTION_ROUTE_DEFS[route].steps.find((s) => s.kind === "REVIEW");
  return step && step.kind === "REVIEW" ? step.gates : [];
}

export function routeTaskSteps(route: ProductionRoute) {
  return PRODUCTION_ROUTE_DEFS[route].steps
    .map((s, index) => ({ ...s, index }))
    .filter(
      (s): s is Extract<RouteStep, { kind: "TASK" }> & { index: number } => s.kind === "TASK",
    );
}

// ── Versions & assets ──────────────────────────────────────────────────────

export const ExternalAssetProvider = {
  CANVA: "CANVA",
  FIGMA: "FIGMA",
  GOOGLE_DRIVE: "GOOGLE_DRIVE",
  DROPBOX: "DROPBOX",
  FRAME_IO: "FRAME_IO",
  OTHER: "OTHER",
} as const;
export type ExternalAssetProvider =
  (typeof ExternalAssetProvider)[keyof typeof ExternalAssetProvider];
export const EXTERNAL_ASSET_PROVIDERS = Object.values(ExternalAssetProvider);
export const EXTERNAL_ASSET_PROVIDER_LABEL: Record<ExternalAssetProvider, string> = {
  CANVA: "Canva",
  FIGMA: "Figma",
  GOOGLE_DRIVE: "Google Drive",
  DROPBOX: "Dropbox",
  FRAME_IO: "Frame.io",
  OTHER: "Link",
};

export function detectAssetProvider(url: string): ExternalAssetProvider {
  const host = safeHost(url);
  if (!host) return "OTHER";
  if (host.endsWith("canva.com")) return "CANVA";
  if (host.endsWith("figma.com")) return "FIGMA";
  if (host === "drive.google.com" || host === "docs.google.com") return "GOOGLE_DRIVE";
  if (host.endsWith("dropbox.com")) return "DROPBOX";
  if (host.endsWith("frame.io") || host === "f.io") return "FRAME_IO";
  return "OTHER";
}

export const MAX_VERSION_ASSETS = 10;
export const MAX_CONTENT_REFERENCES = 10;

export function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Display a stored hashtag with exactly one leading "#" (stored values may or may not have it). */
export const hashtag = (h: string) => `#${h.replace(/^#+/, "")}`;
