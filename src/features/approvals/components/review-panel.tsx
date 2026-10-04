"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardCheck, MessageSquareWarning, Send } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  decideInternalReviewAction,
  recordClientApprovalAction,
  submitForReviewAction,
} from "@/features/approvals/actions";
import { AssetLinks, CaptionBlock, VersionChip, MediaPreviews } from "@/features/approvals/components/approval-bits";
import type { ReviewStateDTO } from "@/features/approvals/types";
import type { VersionDTO } from "@/features/content/types";
import type { ActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/dates";

type Dialog = "approve" | "changes" | "record" | null;

/**
 * Where the content stands in review, the exact version under review, and
 * the actions this viewer may take (computed server-side; the server
 * re-checks every rule on submit).
 */
export function ReviewPanel({
  state,
  versions,
  timeZone,
}: {
  state: ReviewStateDTO;
  versions: VersionDTO[];
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string[] | undefined>();
  const s = state;
  const reviewed = s.underReview ? versions.find((v) => v.id === s.underReview!.versionId) : undefined;
  const when = (iso: string) => formatDate(iso, timeZone, { hour: "numeric", minute: "2-digit" });

  function run(fn: () => Promise<ActionResult<unknown>>, ok: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        if (res.error.fieldErrors) setError(Object.values(res.error.fieldErrors).flat());
        else toast.error(res.error.message);
        if (res.error.code === "CONFLICT") router.refresh();
        return;
      }
      toast.success(ok);
      setDialog(null);
      setText("");
      router.refresh();
    });
  }
  const open = (d: Dialog) => {
    setText("");
    setError(undefined);
    setDialog(d);
  };

  const cr = s.changeRequest;
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      {s.status === "CHANGES_REQUESTED" && cr && (
        <div className="rounded-lg border border-tone-warning/30 bg-tone-warning-bg/60 px-3.5 py-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <MessageSquareWarning className="size-4 text-tone-warning" />
            {cr.revision
              ? `Revision ${cr.revision} — a new version is needed`
              : cr.stage === "CLIENT"
                ? "The client asked for changes"
                : "Changes requested in internal review"}
            <VersionChip n={cr.versionNumber} />
          </p>
          <p className="mt-1.5 text-sm text-pretty whitespace-pre-line">{cr.comment}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {cr.source === "CLIENT_USER" ? "Client" : (cr.decidedBy?.name ?? "Reviewer")} · {when(cr.decidedAt)} · Add a new
            version, then submit it for review.
            {cr.revision ? ` V${cr.versionNumber} and everything already posted stay in the history.` : ""}
          </p>
        </div>
      )}

      {s.revisions.length > 0 && (
        <details className="rounded-lg border px-3.5 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Revision history · {s.revisions.length}</summary>
          <ol className="mt-2 grid gap-2">
            {s.revisions.map((r) => (
              <li key={r.number}>
                <span className="font-medium">Revision {r.number}</span> from V{r.fromVersionNumber} ({r.previousStatus.replace(/_/g, " ").toLowerCase()}) ·{" "}
                {r.startedBy?.name ?? "Someone"} · {when(r.startedAt)}
                <span className="block text-muted-foreground">{r.reason}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {s.underReview && (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <VersionChip n={s.underReview.versionNumber} />
            <span className="font-medium">
              {s.status === "INTERNAL_REVIEW" ? "Waiting for internal review" : "Approved internally — waiting for the client"}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Submitted by {s.underReview.submittedBy?.name ?? "someone"} · {when(s.underReview.submittedAt)}
          </p>
          {reviewed && (
            <>
              <MediaPreviews assets={reviewed.assets} />
              <AssetLinks assets={reviewed.assets} />
              <CaptionBlock caption={reviewed.caption} hashtags={reviewed.hashtags} />
            </>
          )}
        </div>
      )}

      {s.status === "READY_TO_POST" && s.clientApprovedVersionNumber && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <VersionChip n={s.clientApprovedVersionNumber} />
          <span className="font-medium">Approved by the client — ready to post</span>
        </p>
      )}

      {!s.underReview && s.status !== "READY_TO_POST" && s.status !== "CHANGES_REQUESTED" && !s.canSubmit && !s.submitHint && (
        <p className="text-sm text-muted-foreground">Not in review yet.</p>
      )}

      {(s.canSubmit || s.canDecideInternal || s.canRecordClientApproval) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {s.canSubmit && (
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => submitForReviewAction({ contentId: s.contentId, versionId: s.canSubmit!.versionId }),
                  `V${s.canSubmit!.versionNumber} sent for review`,
                )
              }
            >
              <Send data-icon="inline-start" />
              Submit V{s.canSubmit.versionNumber} for review
            </Button>
          )}
          {s.canDecideInternal && (
            <>
              <Button disabled={pending} onClick={() => open("approve")}>
                <Check data-icon="inline-start" />
                Approve V{s.underReview?.versionNumber}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => open("changes")}>
                <MessageSquareWarning data-icon="inline-start" />
                Request changes
              </Button>
            </>
          )}
          {s.canRecordClientApproval && (
            <Button variant="outline" disabled={pending} onClick={() => open("record")}>
              <ClipboardCheck data-icon="inline-start" />
              Record client approval
            </Button>
          )}
        </div>
      )}
      {!s.canSubmit && s.submitHint && ["IN_PRODUCTION", "CHANGES_REQUESTED"].includes(s.status) && (
        <p className="text-sm text-muted-foreground">{s.submitHint}</p>
      )}

      {dialog && s.underReview && (
        <ResponsiveDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={
            dialog === "approve"
              ? `Approve V${s.underReview.versionNumber}?`
              : dialog === "changes"
                ? "Request changes"
                : "Record the client's approval"
          }
          description={
            dialog === "approve"
              ? "It goes to the client for their approval next."
              : dialog === "changes"
                ? "The creator adds a new version; it comes back to internal review."
                : "Use only when the client approved outside PhotoXo (e.g. WhatsApp). It is recorded as entered by you, not as the client's own click."
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="review-text">
                {dialog === "approve" ? "Comment (optional, internal)" : dialog === "changes" ? "What should change? (internal)" : "How did the client approve? (internal note)"}
              </Label>
              <Textarea
                id="review-text"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={!!error}
                placeholder={dialog === "record" ? "e.g. Approved by Amit on WhatsApp, 3 Oct 4:10 PM" : undefined}
              />
              <FieldError messages={error} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={pending || (dialog !== "approve" && text.trim().length < 3)}
                onClick={() => {
                  const base = { contentId: s.contentId, versionId: s.underReview!.versionId };
                  if (dialog === "record") run(() => recordClientApprovalAction({ ...base, note: text }), "Client approval recorded");
                  else
                    run(
                      () =>
                        decideInternalReviewAction({
                          ...base,
                          decision: dialog === "approve" ? "APPROVED" : "CHANGES_REQUESTED",
                          comment: text || null,
                        }),
                      dialog === "approve" ? "Approved — sent to the client" : "Changes requested",
                    );
                }}
              >
                {dialog === "approve" ? "Approve" : dialog === "changes" ? "Request changes" : "Record approval"}
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </div>
  );
}
