"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import {
  canCorrectPostings,
  canProposeIdeas,
  canRecordPostingOnBehalf,
  canReopenApprovedContent,
  canSetTargetPlatforms,
  canStartRevision,
} from "@/server/authz/permissions";
import { reopenForChanges, startRevision } from "@/server/services/approvals.service";
import {
  confirmPosted,
  correctPosting,
  recordPostingOnBehalf,
  setTargetPlatforms,
  startPosting,
} from "@/server/services/postings.service";
import {
  confirmPostedSchema,
  correctPostingSchema,
  recordPostingOnBehalfSchema,
  reopenForChangesSchema,
  startPostingSchema,
  startRevisionSchema,
  targetPlatformsSchema,
} from "./schemas";

// Coarse capability BEFORE validation; the posting service re-derives the
// approved version, required platforms and effective uploader server-side.

function revalidatePosting(contentId?: string) {
  revalidatePath("/work/to-post");
  if (contentId) revalidatePath(`/work/to-post/${contentId}`);
  revalidatePath("/admin/ready-to-post");
  revalidatePath("/admin/content");
  if (contentId) revalidatePath(`/admin/content/${contentId}`);
  revalidatePath("/admin/approvals");
  revalidatePath("/client", "layout");
}

const internal = { authorize: canProposeIdeas }; // ADMIN / MANAGER / STAFF; the service requires the assigned uploader

export const startPostingAction = authedAction(
  startPostingSchema,
  async (actor, input) => {
    await startPosting(actor, input);
    revalidatePosting(input.contentId);
  },
  internal,
);

export const confirmPostedAction = authedAction(
  confirmPostedSchema,
  async (actor, input) => {
    const r = await confirmPosted(actor, input);
    revalidatePosting(input.contentId);
    return { completed: r.completed };
  },
  internal,
);

export const recordPostingOnBehalfAction = authedAction(
  recordPostingOnBehalfSchema,
  async (actor, input) => {
    const r = await recordPostingOnBehalf(actor, input);
    revalidatePosting(input.contentId);
    return { completed: r.completed };
  },
  { authorize: canRecordPostingOnBehalf },
);

export const correctPostingAction = authedAction(
  correctPostingSchema,
  async (actor, input) => {
    await correctPosting(actor, input);
    revalidatePosting();
  },
  { authorize: canCorrectPostings },
);

export const setTargetPlatformsAction = authedAction(
  targetPlatformsSchema,
  async (actor, input) => {
    await setTargetPlatforms(actor, input);
    revalidatePosting(input.contentId);
  },
  { authorize: canSetTargetPlatforms },
);

export const reopenForChangesAction = authedAction(
  reopenForChangesSchema,
  async (actor, input) => {
    await reopenForChanges(actor, input);
    revalidatePosting(input.contentId);
  },
  { authorize: canReopenApprovedContent },
);

export const startRevisionAction = authedAction(
  startRevisionSchema,
  async (actor, input) => {
    const r = await startRevision(actor, input);
    revalidatePosting(input.contentId);
    return r;
  },
  { authorize: canStartRevision },
);
