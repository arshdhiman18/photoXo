import "server-only";
import type {
  ContentClientDTO,
  PersonRef,
  ReferenceDTO,
  TaskDTO,
  VersionDTO,
} from "@/features/content/types";
import {
  ASSIGNEE_TASK_TRANSITIONS,
  SUPERVISOR_TASK_STATUSES,
  PRODUCTION_STATUSES,
  TASK_STATUSES,
  type ContentStatus,
  type TaskStatus,
} from "@/lib/domain/content";
import type { Actor } from "@/server/authz/actor";
import { assetViewUrl } from "@/server/media/urls";
import { clientStatusLabel } from "./approvals";

/** One version asset for an AUTHORISED viewer (links as entered; media via signed URL). */
export function mediaAssetDTO(a: AssetDoc) {
  const url = assetViewUrl(a);
  return {
    id: String(a._id),
    kind: a.storage,
    url,
    provider: a.external?.provider ?? null,
    label: a.external?.label ?? a.originalFilename ?? null,
    previewUrl: a.storage === "MEDIA" ? url : null,
    mediaType: a.media?.resourceType ?? null,
    format: a.media?.format ?? null,
  };
}
import { canManageContent, canManageTasks } from "@/server/authz/permissions";
import type {
  AssetDoc,
  BrandDoc,
  ContentDoc,
  ContentVersionDoc,
  ProductionTaskDoc,
  ReferenceDoc,
} from "@/server/db/models";

type People = Map<string, PersonRef>;
const person = (people: People, id: unknown) => (id ? (people.get(String(id)) ?? null) : null);

export function toReferenceDTO(r: ReferenceDoc, actor: Actor): ReferenceDTO {
  return {
    id: String(r._id),
    platform: r.platform,
    url: r.url ?? null,
    externalId: r.externalId ?? null,
    variant: r.variant ?? null,
    title: r.title ?? null,
    notes: r.notes ?? null,
    thumbnailUrl: r.thumbnailUrl ?? null,
    createdAt: r.createdAt.toISOString(),
    canEdit: canManageContent(actor) || String(r.createdBy) === actor.userId,
  };
}

/** Which status moves this viewer may make on a task (server-computed, re-checked on submit). */
export function allowedTaskStatuses(
  actor: Actor,
  task: Pick<ProductionTaskDoc, "status" | "assignedTo"> & { waitingOn?: "SHOOT" | null },
  contentStatus: ContentStatus,
) {
  if (!PRODUCTION_STATUSES.includes(contentStatus)) return [];
  const own = Boolean(task.assignedTo) && String(task.assignedTo) === actor.userId;
  // Waiting for the shoot: only managers may override (e.g. footage already exists).
  if (task.waitingOn === "SHOOT" && !canManageTasks(actor)) return [];
  const out = new Set<TaskStatus>();
  // Doing the work (start / done) belongs to the assignee — also when that is a manager.
  if (own) for (const s of ASSIGNEE_TASK_TRANSITIONS[task.status]) out.add(s);
  // Supervisors (ADMIN/MANAGER) plan, never perform: unblock / block, remove, restore.
  if (canManageTasks(actor)) {
    if (task.status === "CANCELLED") out.add("TODO");
    else for (const s of SUPERVISOR_TASK_STATUSES) if (s !== task.status) out.add(s);
  }
  return TASK_STATUSES.filter((s) => out.has(s));
}

export function toTaskDTO(
  t: ProductionTaskDoc,
  actor: Actor,
  people: People,
  contentStatus: ContentStatus,
): TaskDTO {
  return {
    id: String(t._id),
    contentId: String(t.contentId),
    taskType: t.taskType,
    title: t.title,
    status: t.status,
    source: t.source,
    waitingOnShoot: t.waitingOn === "SHOOT",
    assignee: person(people, t.assignedTo),
    dueDate: t.dueDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    isMine: Boolean(t.assignedTo && String(t.assignedTo) === actor.userId),
    allowedStatuses: allowedTaskStatuses(actor, t, contentStatus),
  };
}

export function toVersionDTO(
  v: ContentVersionDoc,
  assets: Map<string, AssetDoc>,
  people: People,
): VersionDTO {
  return {
    id: String(v._id),
    versionNumber: v.versionNumber,
    caption: v.caption ?? null,
    hashtags: v.hashtags,
    changeNote: v.changeNote ?? null,
    assets: v.assetIds
      .map((id) => assets.get(String(id)))
      .filter((a): a is AssetDoc => Boolean(a))
      .map((a) => mediaAssetDTO(a)),
    createdBy: person(people, v.createdBy),
    createdAt: v.createdAt.toISOString(),
  };
}

/**
 * Client serializer. Allow-list only: deliberately reads NOTHING internal
 * (no notes, description/brief, code, route, origin, tasks, people, ideas,
 * uploader, audit). New Content fields are invisible to clients by default.
 */
export function toContentClientDTO(
  c: ContentDoc,
  brand: Pick<BrandDoc, "_id" | "name" | "logo">,
): ContentClientDTO {
  return {
    id: String(c._id),
    title: c.title,
    brand: { id: String(brand._id), name: brand.name, logoUrl: brand.logo?.url ?? null },
    contentType: c.contentType,
    statusLabel: clientStatusLabel(c),
    updatedAt: c.updatedAt.toISOString(),
  };
}
