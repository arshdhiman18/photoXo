"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideClientReviewAction } from "@/features/approvals/actions";

/**
 * Approve / Request changes for the exact version on screen. Sticky above the
 * phone tab bar so the decision is always within thumb reach.
 */
export function ClientDecisionBar({
  contentId,
  versionId,
  versionNumber,
}: {
  contentId: string;
  versionId: string;
  versionNumber: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"APPROVED" | "CHANGES_REQUESTED" | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string[] | undefined>();
  const changes = mode === "CHANGES_REQUESTED";

  function open(m: "APPROVED" | "CHANGES_REQUESTED") {
    setComment("");
    setError(undefined);
    setMode(m);
  }

  function submit() {
    if (!mode) return;
    start(async () => {
      const res = await decideClientReviewAction({ contentId, versionId, decision: mode, comment: comment || null });
      if (!res.ok) {
        if (res.error.fieldErrors?.comment) setError(res.error.fieldErrors.comment);
        else {
          toast.error(res.error.message);
          setMode(null);
          router.refresh();
        }
        return;
      }
      toast.success(changes ? "Thanks — we'll make the changes" : "Approved. Thank you!");
      setMode(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="sticky bottom-[calc(var(--spacing-bottomnav)+env(safe-area-inset-bottom)+0.75rem)] z-20 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-4">
        <p className="mb-2 px-1 text-sm text-muted-foreground">
          Your decision applies to <span className="font-medium text-foreground">version {versionNumber}</span> — media,
          caption and hashtags together.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" disabled={pending} onClick={() => open("CHANGES_REQUESTED")}>
            <MessageSquareText data-icon="inline-start" />
            Request changes
          </Button>
          <Button size="lg" disabled={pending} onClick={() => open("APPROVED")}>
            <Check data-icon="inline-start" />
            Approve
          </Button>
        </div>
      </div>
      {mode && (
        <ResponsiveDialog
          open
          onOpenChange={(o) => !o && setMode(null)}
          title={changes ? "What should we change?" : `Approve version ${versionNumber}?`}
          description={
            changes ? "Be as specific as you like — we'll send you a new version." : "Once approved, it's ready to be posted."
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="client-comment">{changes ? "Your comments" : "Comment (optional)"}</Label>
              <Textarea
                id="client-comment"
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                aria-invalid={!!error}
              />
              <FieldError messages={error} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setMode(null)}>
                Back
              </Button>
              <Button disabled={pending || (changes && comment.trim().length < 3)} onClick={submit}>
                {changes ? "Send change request" : "Approve"}
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}
