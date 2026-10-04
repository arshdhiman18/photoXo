"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import {
  canApproveContent,
  canGiveClientApproval,
  canProposeIdeas,
  canRecordClientApprovalOnBehalf,
} from "@/server/authz/permissions";
import {
  decideClientReview,
  decideInternalReview,
  recordClientApprovalOnBehalf,
  submitForInternalReview,
} from "@/server/services/approvals.service";
import { recordClientApprovalSchema, reviewDecisionSchema, submitForReviewSchema } from "./schemas";

// Coarse capability BEFORE validation (authorize); scope, version and state
// checks happen in the approval service. Actions never touch content.status.

function revalidateApprovals(contentId: string) {
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/content");
  revalidatePath(`/admin/content/${contentId}`);
  revalidatePath("/work/content");
  revalidatePath(`/work/content/${contentId}`);
  revalidatePath("/client", "layout");
}

export const submitForReviewAction = authedAction(
  submitForReviewSchema,
  async (actor, input) => {
    await submitForInternalReview(actor, input);
    revalidateApprovals(input.contentId);
  },
  { authorize: canProposeIdeas }, // internal users; the service narrows to managers + assigned creators
);

export const decideInternalReviewAction = authedAction(
  reviewDecisionSchema,
  async (actor, input) => {
    await decideInternalReview(actor, input);
    revalidateApprovals(input.contentId);
  },
  { authorize: canApproveContent },
);

export const decideClientReviewAction = authedAction(
  reviewDecisionSchema,
  async (actor, input) => {
    await decideClientReview(actor, input);
    revalidateApprovals(input.contentId);
  },
  { authorize: canGiveClientApproval },
);

export const recordClientApprovalAction = authedAction(
  recordClientApprovalSchema,
  async (actor, input) => {
    await recordClientApprovalOnBehalf(actor, input);
    revalidateApprovals(input.contentId);
  },
  { authorize: canRecordClientApprovalOnBehalf },
);
