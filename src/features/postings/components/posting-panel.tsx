"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Pencil, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmPostedAction,
  correctPostingAction,
  recordPostingOnBehalfAction,
  startPostingAction,
} from "@/features/postings/actions";
import { PlatformStateBadge } from "@/features/postings/components/posting-bits";
import type { PlatformRowDTO, PostingWorkspaceDTO } from "@/features/postings/types";
import type { ActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/dates";
import { POSTING_PLATFORM_LABEL, type PostingPlatform } from "@/lib/domain/postings";

type Mode = { kind: "post" | "admin"; platform: PostingPlatform } | { kind: "correct"; row: PlatformRowDTO } | null;
type Errors = Record<string, string[] | undefined>;

/** datetime-local value → ISO with offset (empty = "now", decided by the server). */
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

/**
 * Per-platform posting for the client-approved version. Every action is an
 * explicit confirmation re-checked by the server (assigned uploader, approved
 * version, required platform, valid link).
 */
export function PostingPanel({ ws, timeZone, internalDetail }: { ws: PostingWorkspaceDTO; timeZone: string; internalDetail?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [errors, setErrors] = useState<Errors>({});
  const versionId = ws.approvedVersion?.id ?? "";
  const when = (iso: string) => formatDate(iso, timeZone, { hour: "numeric", minute: "2-digit" });

  function run(fn: () => Promise<ActionResult<unknown>>, ok: (data: unknown) => string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        else {
          toast.error(res.error.message);
          if (res.error.code === "CONFLICT") router.refresh();
        }
        return;
      }
      toast.success(ok(res.data));
      setMode(null);
      router.refresh();
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!mode) return;
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    const doneMsg = (d: unknown) => ((d as { completed?: boolean } | undefined)?.completed ? "All platforms posted — content completed" : "Marked as posted");
    if (mode.kind === "correct") {
      run(
        () =>
          correctPostingAction({
            postingId: mode.row.posting!.id,
            postUrl: get("postUrl"),
            postedAt: toIso(get("postedAt")),
            screenshotUrl: get("screenshotUrl"),
            reason: get("reason"),
          }),
        () => "Post corrected",
      );
      return;
    }
    const base = {
      contentId: ws.content.id,
      versionId,
      platform: mode.platform,
      postUrl: get("postUrl"),
      postedAt: toIso(get("postedAt")),
      screenshotUrl: get("screenshotUrl"),
      note: get("note"),
    };
    if (mode.kind === "admin") run(() => recordPostingOnBehalfAction({ ...base, reason: get("reason") }), doneMsg);
    else run(() => confirmPostedAction(base), doneMsg);
  }

  const open = (m: Mode) => {
    setErrors({});
    setMode(m);
  };
  const platformOf = (m: NonNullable<Mode>) => (m.kind === "correct" ? m.row.platform : m.platform);

  return (
    <>
      {ws.platforms.length === 0 ? (
        <p className="px-4 py-4 text-sm text-tone-warning sm:px-5">No platforms are set for this content.</p>
      ) : (
        <ul className="divide-y">
          {ws.platforms.map((row) => {
            const p = row.posting;
            return (
              <li key={row.platform} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{POSTING_PLATFORM_LABEL[row.platform]}</span>
                    <PlatformStateBadge state={row.state} />
                  </p>
                  {p?.postUrl && (
                    <a
                      href={p.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 text-sm text-tone-info hover:underline"
                    >
                      <span className="truncate">{p.postUrl}</span>
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  )}
                  {p?.postedAt && (
                    <p className="text-xs text-muted-foreground">
                      Posted {when(p.postedAt)}
                      {p.postedBy && ` by ${p.postedBy.name}`}
                      {p.source === "RECORDED_BY_ADMIN" && ` · recorded by ${p.recordedBy?.name ?? "an admin"}`}
                    </p>
                  )}
                  {row.state === "POSTING" && p && <p className="text-xs text-muted-foreground">Started {when(p.startedAt)}</p>}
                  {internalDetail && p?.adminReason && <p className="text-xs text-muted-foreground">Reason: {p.adminReason}</p>}
                  {p?.screenshotUrl && (
                    <a href={p.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline">
                      Proof
                    </a>
                  )}
                  {p?.note && <p className="text-xs text-pretty text-muted-foreground">Note: {p.note}</p>}
                  {internalDetail && p && p.corrections.length > 0 && (
                    <ul className="mt-1 grid gap-1 rounded-md bg-subtle px-3 py-2 text-xs text-muted-foreground">
                      {p.corrections.map((c, i) => (
                        <li key={i} className="[overflow-wrap:anywhere]">
                          Corrected {when(c.correctedAt)} by {c.correctedBy?.name ?? "an admin"} — was {c.previousUrl ?? "—"}
                          {c.previousPostedAt && ` (${when(c.previousPostedAt)})`}. {c.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {ws.canPost && row.state === "PENDING" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() => startPostingAction({ contentId: ws.content.id, versionId, platform: row.platform }), () => "Marked as posting")
                      }
                    >
                      <Play data-icon="inline-start" />
                      Start
                    </Button>
                  )}
                  {ws.canPost && row.state !== "POSTED" && (
                    <Button size="sm" disabled={pending} onClick={() => open({ kind: "post", platform: row.platform })}>
                      <CheckCircle2 data-icon="inline-start" />
                      Mark posted
                    </Button>
                  )}
                  {ws.canRecordOnBehalf && row.state !== "POSTED" && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => open({ kind: "admin", platform: row.platform })}>
                      <ShieldCheck data-icon="inline-start" />
                      Record for uploader
                    </Button>
                  )}
                  {ws.canCorrect && row.state === "POSTED" && p && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => open({ kind: "correct", row })}>
                      <Pencil data-icon="inline-start" />
                      Correct
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {mode && (
        <ResponsiveDialog
          open
          onOpenChange={(o) => !o && setMode(null)}
          title={
            mode.kind === "correct"
              ? `Correct the ${POSTING_PLATFORM_LABEL[platformOf(mode)]} post`
              : mode.kind === "admin"
                ? `Record the ${POSTING_PLATFORM_LABEL[platformOf(mode)]} post for the uploader`
                : `Mark ${POSTING_PLATFORM_LABEL[platformOf(mode)]} as posted`
          }
          description={
            mode.kind === "correct"
              ? "The previous link and time are kept in the history."
              : mode.kind === "admin"
                ? "Recorded as entered by you on the uploader's behalf — never as their own confirmation."
                : `Post exactly version ${ws.approvedVersion?.versionNumber} with the approved caption, then paste the live link.`
          }
        >
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pp-url">Post link</Label>
              <Input
                id="pp-url"
                name="postUrl"
                inputMode="url"
                required
                defaultValue={mode.kind === "correct" ? (mode.row.posting?.postUrl ?? "") : ""}
                placeholder="https://"
                aria-invalid={!!errors.postUrl}
              />
              <FieldError messages={errors.postUrl} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pp-at">
                Posted at <span className="font-normal text-muted-foreground">({mode.kind === "correct" ? "leave empty to keep" : "leave empty for now"})</span>
              </Label>
              <Input id="pp-at" name="postedAt" type="datetime-local" aria-invalid={!!errors.postedAt} />
              <FieldError messages={errors.postedAt} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pp-proof">
                Screenshot link <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="pp-proof" name="screenshotUrl" inputMode="url" placeholder="https://drive.google.com/…" aria-invalid={!!errors.screenshotUrl} />
              <FieldError messages={errors.screenshotUrl} />
            </div>
            {mode.kind !== "correct" && (
              <div className="grid gap-1.5">
                <Label htmlFor="pp-note">
                  Note <span className="font-normal text-muted-foreground">(optional, internal)</span>
                </Label>
                <Input id="pp-note" name="note" />
              </div>
            )}
            {mode.kind !== "post" && (
              <div className="grid gap-1.5">
                <Label htmlFor="pp-reason">Reason</Label>
                <Textarea id="pp-reason" name="reason" rows={2} required aria-invalid={!!errors.reason} />
                <FieldError messages={errors.reason} />
              </div>
            )}
            <FieldError messages={errors.platform} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setMode(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {mode.kind === "correct" ? "Save correction" : mode.kind === "admin" ? "Record post" : "Confirm posted"}
              </Button>
            </div>
          </form>
        </ResponsiveDialog>
      )}
    </>
  );
}
