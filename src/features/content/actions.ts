"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import {
  canManageContent,
  canManageTasks,
  canProposeIdeas,
  canReviewIdeas,
} from "@/server/authz/permissions";
import {
  archiveContent,
  deleteContent,
  cancelContent,
  changeRoute,
  createBrief,
  createIdea,
  decideIdea,
  listBrandUploaders,
  resubmitIdea,
  setUploaderOverride,
  updateContent,
} from "@/server/services/content.service";
import {
  createReference,
  listBrandReferences,
  updateReference,
} from "@/server/services/references.service";
import {
  assignTask,
  createTask,
  searchAssignees,
  updateTaskStatus,
} from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import {
  assigneeSearchSchema,
  assignTaskSchema,
  brandReferencesSchema,
  cancelContentSchema,
  changeRouteSchema,
  contentTargetSchema,
  createBriefSchema,
  createIdeaSchema,
  createReferenceSchema,
  createTaskSchema,
  createVersionSchema,
  ideaDecisionSchema,
  taskStatusSchema,
  updateContentSchema,
  updateReferenceSchema,
  uploaderOverrideSchema,
} from "./schemas";

// Coarse capability before validation (authorize); scope + target rules in services.
const ops = { authorize: canManageContent };
const internal = { authorize: canProposeIdeas }; // ADMIN / MANAGER / STAFF — never clients

function revalidateContent(contentId?: string) {
  revalidatePath("/admin/content");
  revalidatePath("/work/content");
  revalidatePath("/work/tasks");
  revalidatePath("/work");
  if (contentId) {
    revalidatePath(`/admin/content/${contentId}`);
    revalidatePath(`/work/content/${contentId}`);
  }
}

// ── Content ────────────────────────────────────────────────────────────────

export const createBriefAction = authedAction(
  createBriefSchema,
  async (actor, input) => {
    const res = await createBrief(actor, input);
    revalidateContent();
    return res;
  },
  ops,
);

export const createIdeaAction = authedAction(
  createIdeaSchema,
  async (actor, input) => {
    const res = await createIdea(actor, input);
    revalidateContent();
    return res;
  },
  { authorize: canProposeIdeas },
);

export const updateContentAction = authedAction(
  updateContentSchema,
  async (actor, input) => {
    await updateContent(actor, input);
    revalidateContent(input.contentId);
    return null;
  },
  internal,
);

export const decideIdeaAction = authedAction(
  ideaDecisionSchema,
  async (actor, input) => {
    await decideIdea(actor, input);
    revalidateContent(input.contentId);
    return null;
  },
  { authorize: canReviewIdeas },
);

export const resubmitIdeaAction = authedAction(
  contentTargetSchema,
  async (actor, { contentId }) => {
    await resubmitIdea(actor, contentId);
    revalidateContent(contentId);
    return null;
  },
  internal,
);

export const changeRouteAction = authedAction(
  changeRouteSchema,
  async (actor, input) => {
    await changeRoute(actor, input);
    revalidateContent(input.contentId);
    return null;
  },
  ops,
);

export const cancelContentAction = authedAction(
  cancelContentSchema,
  async (actor, { contentId, reason }) => {
    await cancelContent(actor, contentId, reason);
    revalidateContent(contentId);
    return null;
  },
  ops,
);

export const deleteContentAction = authedAction(
  contentTargetSchema,
  async (actor, { contentId }) => {
    await deleteContent(actor, contentId);
    revalidatePath("/admin/content");
    revalidatePath("/work/content");
    return null;
  },
  ops,
);

export const archiveContentAction = authedAction(
  contentTargetSchema,
  async (actor, { contentId }) => {
    await archiveContent(actor, contentId);
    revalidateContent(contentId);
    return null;
  },
  ops,
);

export const setUploaderOverrideAction = authedAction(
  uploaderOverrideSchema,
  async (actor, { contentId, userId }) => {
    await setUploaderOverride(actor, contentId, userId);
    revalidateContent(contentId);
    return null;
  },
  ops,
);

export const listBrandUploadersAction = authedAction(
  contentTargetSchema,
  (actor, { contentId }) => listBrandUploaders(actor, contentId),
  ops,
);

// ── Tasks ──────────────────────────────────────────────────────────────────

export const createTaskAction = authedAction(
  createTaskSchema,
  async (actor, input) => {
    const res = await createTask(actor, input);
    revalidateContent(input.contentId);
    return res;
  },
  { authorize: canManageTasks },
);

export const assignTaskAction = authedAction(
  assignTaskSchema,
  async (actor, { taskId, assignedTo }) => {
    await assignTask(actor, taskId, assignedTo);
    revalidateContent();
    return null;
  },
  { authorize: canManageTasks },
);

export const updateTaskStatusAction = authedAction(
  taskStatusSchema,
  async (actor, { taskId, status }) => {
    await updateTaskStatus(actor, taskId, status);
    revalidateContent();
    return null;
  },
  internal,
);

export const searchAssigneesAction = authedAction(
  assigneeSearchSchema,
  (actor, input) => searchAssignees(actor, input),
  { authorize: canManageTasks },
);

// ── References ─────────────────────────────────────────────────────────────

export const createReferenceAction = authedAction(
  createReferenceSchema,
  (actor, input) => createReference(actor, input),
  internal,
);

export const updateReferenceAction = authedAction(
  updateReferenceSchema,
  async (actor, input) => {
    const res = await updateReference(actor, input);
    revalidateContent();
    return res;
  },
  internal,
);

export const listBrandReferencesAction = authedAction(
  brandReferencesSchema,
  (actor, { brandId }) => listBrandReferences(actor, brandId),
  internal,
);

// ── Versions ───────────────────────────────────────────────────────────────

export const createVersionAction = authedAction(
  createVersionSchema,
  async (actor, input) => {
    const res = await createVersion(actor, input);
    revalidateContent(input.contentId);
    return res;
  },
  internal,
);
