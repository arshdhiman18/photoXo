import { z } from "zod";
import { APPROVAL_COMMENT_MAX, APPROVAL_DECISIONS, APPROVAL_STAGES } from "@/lib/domain/approvals";
import { objectIdString } from "@/lib/validation";

// Strict: decidedBy, userId, agencyId, brandId, stage, status and source are
// never accepted from the browser. `versionId` is only the version the viewer
// was looking at — the server checks it against the content's own review
// pointer and refuses stale or foreign versions.

const target = { contentId: objectIdString, versionId: objectIdString };

export const submitForReviewSchema = z.object(target).strict();

export const reviewDecisionSchema = z
  .object({
    ...target,
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z
      .string()
      .trim()
      .max(APPROVAL_COMMENT_MAX, `Use at most ${APPROVAL_COMMENT_MAX} characters`)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .strict()
  .refine((d) => d.decision === "APPROVED" || (d.comment?.length ?? 0) >= 3, {
    path: ["comment"],
    message: "Tell them what to change",
  });

export const recordClientApprovalSchema = z
  .object({
    ...target,
    note: z
      .string()
      .trim()
      .min(3, "Explain how the client approved (e.g. WhatsApp, 3 Oct)")
      .max(APPROVAL_COMMENT_MAX),
  })
  .strict();

export const recentDecisionsQuerySchema = z.object({
  stage: z.enum(APPROVAL_STAGES).optional().catch(undefined),
  decision: z.enum(APPROVAL_DECISIONS).optional().catch(undefined),
  brand: objectIdString.optional().catch(undefined),
});
export type RecentDecisionsQuery = z.output<typeof recentDecisionsQuerySchema>;
