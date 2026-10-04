"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reopenForChangesAction, setTargetPlatformsAction, startRevisionAction } from "@/features/postings/actions";
import { PlatformPicker } from "@/features/postings/components/platform-picker";
import { POSTING_PLATFORM_LABEL, type PostingPlatform } from "@/lib/domain/postings";

/** Required platforms — the single source of truth, editable until posting starts. */
export function TargetPlatformsControl({
  contentId,
  value,
  editable,
}: {
  contentId: string;
  value: PostingPlatform[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<PostingPlatform[]>(value);
  const [error, setError] = useState<string[] | undefined>();
  const dirty = JSON.stringify([...draft].sort()) !== JSON.stringify([...value].sort());

  if (!editable) {
    return value.length ? (
      <p className="text-sm">{value.map((p) => POSTING_PLATFORM_LABEL[p]).join(" · ")}</p>
    ) : (
      <p className="text-sm text-tone-warning">Not set</p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <PlatformPicker value={draft} onChange={setDraft} disabled={pending} />
      <FieldError messages={error} />
      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await setTargetPlatformsAction({ contentId, platforms: draft });
                if (!res.ok) {
                  if (res.error.fieldErrors?.platforms) setError(res.error.fieldErrors.platforms);
                  else toast.error(res.error.message);
                  return;
                }
                setError(undefined);
                toast.success("Platforms saved");
                router.refresh();
              })
            }
          >
            Save platforms
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDraft(value)}>
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}

/** Send approved content back for changes — only before anything is posted. */
export function ReopenForChangesButton({ contentId, versionId }: { contentId: string; versionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string[] | undefined>();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Undo2 data-icon="inline-start" />
        Send back for changes
      </Button>
      {open && (
        <ResponsiveDialog
          open
          onOpenChange={setOpen}
          title="Send back for changes?"
          description="The approved version stays in history. A new version must pass internal and client review again before posting."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="reopen-reason">What needs to change? (internal)</Label>
              <Textarea id="reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} />
              <FieldError messages={error} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending || reason.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const res = await reopenForChangesAction({ contentId, versionId, reason });
                    if (!res.ok) {
                      if (res.error.fieldErrors?.reason) setError(res.error.fieldErrors.reason);
                      else toast.error(res.error.message);
                      return;
                    }
                    toast.success("Sent back for changes");
                    setOpen(false);
                    router.refresh();
                  })
                }
              >
                Send back
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}

/**
 * Post-publication revision (ADMIN/MANAGER): the posted version and all its
 * posting records stay as history; a new version goes through internal
 * review, client review and its own posting round.
 */
export function StartRevisionButton({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string[] | undefined>();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCcw data-icon="inline-start" />
        Create revision
      </Button>
      {open && (
        <ResponsiveDialog
          open
          onOpenChange={setOpen}
          title="Create a new revision?"
          description="What's already posted stays exactly as it is in the history. A new version must pass internal and client review, then gets its own posting round."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="rev-reason">Why is a new version needed? (internal)</Label>
              <Textarea id="rev-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} />
              <FieldError messages={error} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={pending || reason.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const res = await startRevisionAction({ contentId, reason });
                    if (!res.ok) {
                      if (res.error.fieldErrors?.reason) setError(res.error.fieldErrors.reason);
                      else toast.error(res.error.message);
                      return;
                    }
                    toast.success(`Revision ${res.data.revision} started`);
                    setOpen(false);
                    router.refresh();
                  })
                }
              >
                Create revision
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}
