import "server-only";
import type {
  ApprovalRecordDTO,
  ClientApprovalRecordDTO,
  ClientApprovalState,
  ClientVersionDTO,
} from "@/features/approvals/types";
import type { PersonRef } from "@/features/content/types";
import { ApprovalSource, CommentVisibility } from "@/lib/domain/approvals";
import {
  CLIENT_CHANGES_IN_PROGRESS_STATUSES,
  CLIENT_STATUS_LABEL,
  ContentStatus,
} from "@/lib/domain/content";
import type { Actor } from "@/server/authz/actor";
import { assetViewUrl } from "@/server/media/urls";
import type { ApprovalDoc, AssetDoc, ContentDoc, ContentVersionDoc } from "@/server/db/models";

type People = Map<string, PersonRef>;

/** Internal timeline entry (ADMIN / MANAGER / STAFF only). */
export function toApprovalRecordDTO(a: ApprovalDoc, people: People): ApprovalRecordDTO {
  return {
    id: String(a._id),
    stage: a.stage,
    decision: a.decision,
    source: a.source,
    comment: a.comment ?? null,
    commentVisibility: a.commentVisibility,
    version: { id: String(a.contentVersionId), number: a.versionNumber },
    decidedBy: people.get(String(a.decidedBy)) ?? null,
    decidedAt: a.decidedAt.toISOString(),
  };
}

// ── Client audience (allow-lists; nothing internal is ever read) ──────────

const APPROVED_FOR_CLIENT: ContentStatus[] = [
  ContentStatus.READY_TO_POST,
  ContentStatus.POSTED,
  ContentStatus.COMPLETED,
];

/** Where content sits for the client. null = not client-facing (never shown). */
export function clientStateOf(
  c: Pick<ContentDoc, "status" | "clientChangesPending">,
): ClientApprovalState | null {
  if (c.status === ContentStatus.CLIENT_REVIEW) return "AWAITING";
  if (c.clientChangesPending && CLIENT_CHANGES_IN_PROGRESS_STATUSES.includes(c.status)) return "CHANGES";
  if (APPROVED_FOR_CLIENT.includes(c.status)) return "APPROVED";
  return null;
}

/** Client wording. Internal stages (e.g. INTERNAL_REVIEW of a revision) read as "Changes in progress". */
export function clientStatusLabel(c: Pick<ContentDoc, "status" | "clientChangesPending">): string {
  return clientStateOf(c) === "CHANGES"
    ? "Changes in progress"
    : (CLIENT_STATUS_LABEL[c.status] ?? "In progress");
}

/**
 * A CLIENT-gate decision as the client may see it. Never: internal-visibility
 * comments (e.g. an admin's evidence note), staff names, or internal-gate data.
 */
export function toClientApprovalRecordDTO(
  a: ApprovalDoc,
  actor: Actor,
  clientNames: Map<string, string>,
): ClientApprovalRecordDTO {
  const recordedByTeam = a.source === ApprovalSource.RECORDED_BY_ADMIN;
  const byLabel = recordedByTeam
    ? "Your agency team (recorded on your behalf)"
    : String(a.decidedBy) === actor.userId
      ? "You"
      : (clientNames.get(String(a.decidedBy)) ?? "Your team");
  return {
    id: String(a._id),
    decision: a.decision,
    versionNumber: a.versionNumber,
    byLabel,
    recordedByTeam,
    comment: a.commentVisibility === CommentVisibility.CLIENT ? (a.comment ?? null) : null,
    decidedAt: a.decidedAt.toISOString(),
  };
}

/** The exact version a client reviews: media, caption and hashtags only. */
export function toClientVersionDTO(v: ContentVersionDoc, assets: Map<string, AssetDoc>): ClientVersionDTO {
  return {
    id: String(v._id),
    versionNumber: v.versionNumber,
    caption: v.caption ?? null,
    hashtags: v.hashtags,
    assets: v.assetIds
      .map((id) => assets.get(String(id)))
      .filter((a): a is AssetDoc => Boolean(a))
      .map((a) => {
        // Only versions that passed the INTERNAL gate reach this serializer (service-enforced).
        const url = assetViewUrl(a);
        return {
          id: String(a._id),
          kind: a.storage,
          url,
          provider: a.external?.provider ?? null,
          label: a.external?.label ?? null, // uploaded files' original names stay internal
          previewUrl: a.storage === "MEDIA" ? url : null,
          mediaType: a.media?.resourceType ?? null,
          format: a.media?.format ?? null,
        };
      }),
  };
}
