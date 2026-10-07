import { z } from "zod";
import {
  CONTENT_ORIGINS,
  CONTENT_PRIORITIES,
  CONTENT_STATUSES,
  CONTENT_TYPE_KEYS,
  MAX_CONTENT_REFERENCES,
  MAX_VERSION_ASSETS,
  PRODUCTION_ROUTES,
  TASK_STATUSES,
  TASK_TYPES,
} from "@/lib/domain/content";
import { POSTING_PLATFORMS } from "@/lib/domain/postings";
import { objectIdString } from "@/lib/validation";

// Strict schemas: identity/agency/creator fields can never be supplied.

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const title = z
  .string()
  .trim()
  .min(3, "Title must be at least 3 characters")
  .max(160, "Title is too long");

const isoDate = z
  .union([z.literal(""), z.iso.date("Enter a valid date")])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .pipe(z.url({ protocol: /^https?$/, error: "Enter a full link starting with https://" }));

const referenceIds = z.array(objectIdString).max(MAX_CONTENT_REFERENCES).default([]);

const contentType = z.enum(CONTENT_TYPE_KEYS as [string, ...string[]], {
  error: "Choose a content type",
});

/** Admin/manager brief (ADMIN_BRIEF or REFERENCE origin). */
export const createBriefSchema = z
  .object({
    brandId: objectIdString,
    title,
    description: text(5000),
    notes: text(5000),
    contentType,
    origin: z.enum(["ADMIN_BRIEF", "REFERENCE"]),
    route: z.enum(PRODUCTION_ROUTES).optional(),
    priority: z.enum(CONTENT_PRIORITIES).default("NORMAL"),
    dueDate: isoDate,
    referenceIds,
    /** Where it must be posted (required before internal approval; editable later). */
    targetPlatforms: z
      .array(z.enum(POSTING_PLATFORMS))
      .max(POSTING_PLATFORMS.length)
      .default([])
      .transform((v) => [...new Set(v)]),
    /** Optional new reference created in the same step. */
    referenceUrl: z
      .union([z.literal(""), httpUrl])
      .optional()
      .transform((v) => v || null),
  })
  .strict();
export type CreateBriefInput = z.input<typeof createBriefSchema>;

/** Employee "Add idea" (TEAM_IDEA). Reference optional. */
export const createIdeaSchema = z
  .object({
    brandId: objectIdString,
    title,
    description: text(5000),
    notes: text(5000),
    contentType,
    priority: z.enum(CONTENT_PRIORITIES).default("NORMAL"),
    referenceIds,
    referenceUrl: z
      .union([z.literal(""), httpUrl])
      .optional()
      .transform((v) => v || null),
  })
  .strict();
export type CreateIdeaInput = z.input<typeof createIdeaSchema>;

export const updateContentSchema = z
  .object({
    contentId: objectIdString,
    title,
    description: text(5000),
    notes: text(5000),
    contentType,
    priority: z.enum(CONTENT_PRIORITIES),
    dueDate: isoDate,
    referenceIds,
  })
  .strict();
export type UpdateContentInput = z.input<typeof updateContentSchema>;

export const contentTargetSchema = z.object({ contentId: objectIdString }).strict();

export const ideaDecisionSchema = z
  .object({
    contentId: objectIdString,
    decision: z.enum(["ACCEPTED", "REJECTED", "CHANGES_REQUESTED"]),
    note: text(1000),
  })
  .strict()
  .refine((d) => d.decision === "ACCEPTED" || Boolean(d.note), {
    path: ["note"],
    message: "Add a short note so the author knows why",
  });

export const changeRouteSchema = z
  .object({ contentId: objectIdString, route: z.enum(PRODUCTION_ROUTES) })
  .strict();

export const cancelContentSchema = z
  .object({ contentId: objectIdString, reason: text(500) })
  .strict();

export const uploaderOverrideSchema = z
  .object({ contentId: objectIdString, userId: objectIdString.nullable() })
  .strict();

// ── Tasks ──────────────────────────────────────────────────────────────────

export const createTaskSchema = z
  .object({
    contentId: objectIdString,
    taskType: z.enum(TASK_TYPES),
    title: z
      .string()
      .trim()
      .max(160)
      .optional()
      .transform((v) => v || null),
    assignedTo: objectIdString
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    dueDate: isoDate,
  })
  .strict();

export const assignTaskSchema = z
  .object({ taskId: objectIdString, assignedTo: objectIdString.nullable() })
  .strict();

export const taskStatusSchema = z
  .object({ taskId: objectIdString, status: z.enum(TASK_STATUSES) })
  .strict();

export const assigneeSearchSchema = z
  .object({
    contentId: objectIdString,
    taskType: z.enum(TASK_TYPES),
    q: z.string().trim().max(100).default(""),
  })
  .strict();

// ── References ─────────────────────────────────────────────────────────────

export const createReferenceSchema = z
  .object({ brandId: objectIdString, url: httpUrl, title: text(160), notes: text(1000) })
  .strict();

export const updateReferenceSchema = z
  .object({ referenceId: objectIdString, title: text(160), notes: text(1000) })
  .strict();

export const brandReferencesSchema = z.object({ brandId: objectIdString }).strict();

// ── Versions ───────────────────────────────────────────────────────────────

export const createVersionSchema = z
  .object({
    contentId: objectIdString,
    links: z
      .array(z.object({ url: httpUrl, label: text(120) }).strict())
      .max(MAX_VERSION_ASSETS)
      .default([]),
    /** Uploaded media (ids from finalised uploads of THIS content by THIS user — re-checked server-side). */
    assetIds: z.array(objectIdString).max(MAX_VERSION_ASSETS).default([]),
    caption: text(2200),
    hashtags: z
      .string()
      .max(1000)
      .optional()
      .transform((v) =>
        [
          ...new Set(
            (v ?? "")
              .split(/[\s,]+/)
              .map((t) => t.replace(/^#+/, "").trim())
              .filter(Boolean),
          ),
        ]
          .slice(0, 30)
          .map((t) => `#${t}`),
      ),
    changeNote: text(1000),
  })
  .strict()
  .refine((v) => v.links.length + v.assetIds.length > 0, { path: ["links"], message: "Add at least one link or upload" })
  .refine((v) => v.links.length + v.assetIds.length <= MAX_VERSION_ASSETS, { path: ["links"], message: `At most ${MAX_VERSION_ASSETS} files` });
export type CreateVersionInput = z.input<typeof createVersionSchema>;

// ── List queries (URL params; invalid values dropped) ──────────────────────

export const CONTENT_PAGE_SIZE = 25;
export const contentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  brand: objectIdString.optional().catch(undefined),
  type: z
    .enum(CONTENT_TYPE_KEYS as [string, ...string[]])
    .optional()
    .catch(undefined),
  origin: z.enum(CONTENT_ORIGINS).optional().catch(undefined),
  status: z.enum(CONTENT_STATUSES).optional().catch(undefined),
  created: z.enum(["7d", "30d", "90d"]).optional().catch(undefined),
  archived: z.enum(["1"]).optional().catch(undefined),
  priority: z.enum(CONTENT_PRIORITIES).optional().catch(undefined),
  /** overdue = due date passed and not finished; week = due in the next 7 days. */
  due: z.enum(["overdue", "week"]).optional().catch(undefined),
  /** Content with an open task assigned to this person. */
  assignee: objectIdString.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type ContentListQuery = z.output<typeof contentListQuerySchema>;

export const TASK_BOARD_VIEWS = ["open", "in_progress", "blocked", "unassigned", "done", "all"] as const;
export type TaskBoardView = (typeof TASK_BOARD_VIEWS)[number];

/** GET filters for the supervisor task board (invalid values fall back to defaults). */
export const taskBoardQuerySchema = z.object({
  view: z.enum(TASK_BOARD_VIEWS).catch("open").default("open"),
  assignee: objectIdString.optional().catch(undefined),
  brand: objectIdString.optional().catch(undefined),
});
export type TaskBoardQuery = z.infer<typeof taskBoardQuerySchema>;
