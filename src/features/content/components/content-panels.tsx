"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Ban,
  Check,
  MessageSquareWarning,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MediaUploader, type UploadedFile } from "@/features/media/components/media-uploader";
import { UPLOAD_MIME_TYPES } from "@/lib/domain/media";
import {
  archiveContentAction,
  cancelContentAction,
  changeRouteAction,
  createReferenceAction,
  createVersionAction,
  decideIdeaAction,
  listBrandUploadersAction,
  resubmitIdeaAction,
  setUploaderOverrideAction,
  updateContentAction,
} from "@/features/content/actions";
import type {
  IdeaReviewDTO,
  PersonRef,
  ReferenceDTO,
  UploaderInfoDTO,
} from "@/features/content/types";
import type { ActionResult } from "@/lib/action-result";
import {
  CONTENT_PRIORITIES,
  CONTENT_PRIORITY_LABEL,
  CONTENT_TYPE_KEYS,
  CONTENT_TYPES,
  MAX_CONTENT_REFERENCES,
  MAX_VERSION_ASSETS,
  PRODUCTION_ROUTE_DEFS,
  PRODUCTION_ROUTES,
  type ContentPriority,
  type ContentType,
  type ProductionRoute,
} from "@/lib/domain/content";
import { REFERENCE_PLATFORM_LABEL } from "@/lib/domain/references";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error.message);
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

// ── Idea review (manager decision on TEAM_IDEA) ────────────────────────────

export function IdeaReviewPanel({
  contentId,
  review,
}: {
  contentId: string;
  review: IdeaReviewDTO | null;
}) {
  const { run, pending } = useAction();
  const [dialog, setDialog] = useState<"REJECTED" | "CHANGES_REQUESTED" | null>(null);
  const [note, setNote] = useState("");
  return (
    <section className="rounded-xl border border-tone-warning/30 bg-tone-warning-bg/50 p-4 sm:p-5">
      <h2 className="text-sm font-medium">This is a team idea waiting for a decision</h2>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        Accepting plans it and creates its production tasks. This is a planning decision — not
        content approval.
      </p>
      {review?.decision === "CHANGES_REQUESTED" && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Changes requested</span>
          {review.decidedBy && ` by ${review.decidedBy.name}`}: {review.note}
          <span className="text-muted-foreground"> — waiting for the author to resubmit.</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () => decideIdeaAction({ contentId, decision: "ACCEPTED" }),
              "Idea accepted and planned",
            )
          }
        >
          <Check data-icon="inline-start" />
          Accept & plan
        </Button>
        <Button variant="outline" onClick={() => setDialog("CHANGES_REQUESTED")}>
          <MessageSquareWarning data-icon="inline-start" />
          Request changes
        </Button>
        <Button variant="outline" onClick={() => setDialog("REJECTED")}>
          <X data-icon="inline-start" />
          Reject
        </Button>
      </div>
      <ResponsiveDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "REJECTED" ? "Reject this idea?" : "Request changes"}
        description="The author sees your note."
      >
        <div className="flex flex-col gap-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Why, and what would make it work…"
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog === "REJECTED" ? "destructive" : "default"}
              disabled={pending || !note.trim()}
              onClick={() =>
                run(
                  () => decideIdeaAction({ contentId, decision: dialog!, note }),
                  dialog === "REJECTED" ? "Idea rejected" : "Changes requested",
                  () => setDialog(null),
                )
              }
            >
              {dialog === "REJECTED" ? "Reject idea" : "Send request"}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </section>
  );
}

/** Author's view when a manager asked for changes. */
export function IdeaChangesBanner({
  contentId,
  note,
  canResubmit,
}: {
  contentId: string;
  note: string | null;
  canResubmit: boolean;
}) {
  const { run, pending } = useAction();
  return (
    <section className="rounded-xl border border-tone-warning/30 bg-tone-warning-bg/50 p-4">
      <p className="text-sm font-medium">Changes requested on your idea</p>
      {note && <p className="mt-1 text-sm text-pretty">{note}</p>}
      {canResubmit && (
        <Button
          className="mt-3"
          disabled={pending}
          onClick={() => run(() => resubmitIdeaAction({ contentId }), "Idea resubmitted")}
        >
          <Send data-icon="inline-start" />
          Resubmit for review
        </Button>
      )}
    </section>
  );
}

// ── Uploader override ──────────────────────────────────────────────────────

export function UploaderPanel({
  contentId,
  info,
  editable,
}: {
  contentId: string;
  info: UploaderInfoDTO;
  editable: boolean;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PersonRef[] | null>(null);
  const [choice, setChoice] = useState<string>("");

  async function openPicker() {
    setOpen(true);
    const res = await listBrandUploadersAction({ contentId });
    setOptions(res.ok ? res.data : []);
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      {info.effective ? (
        <div className="flex items-center gap-3">
          <UserAvatar
            name={info.effective.name}
            image={info.effective.image}
            seed={info.effective.id}
            className="size-8"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{info.effective.name}</p>
            <p className="text-xs text-muted-foreground">
              {info.source === "OVERRIDE"
                ? "Override for this content"
                : "Brand's primary uploader"}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-tone-warning">
          No uploader — the brand has no primary uploader.
        </p>
      )}
      {info.overrideInvalid && (
        <p className="flex items-start gap-2 rounded-md bg-tone-warning-bg px-2.5 py-2 text-xs text-tone-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          The override is no longer an active uploader on this brand. It was not changed
          automatically — choose another or clear it.
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={openPicker}>
            {info.override ? "Change override" : "Override for this content"}
          </Button>
          {info.override && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => setUploaderOverrideAction({ contentId, userId: null }),
                  "Override removed",
                )
              }
            >
              Use brand default
            </Button>
          )}
        </div>
      )}
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Uploader for this content"
        description="An exception to the brand's primary uploader. Only active Content Uploaders on this brand are listed."
      >
        <div className="flex flex-col gap-4">
          {options === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This brand has no active Content Uploaders.
            </p>
          ) : (
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose an uploader" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                    {o.id === info.brandPrimary?.id ? " (brand primary)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !choice}
              onClick={() =>
                run(
                  () => setUploaderOverrideAction({ contentId, userId: choice }),
                  "Uploader override set",
                  () => setOpen(false),
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}

// ── Route ──────────────────────────────────────────────────────────────────

export function ChangeRouteButton({
  contentId,
  route,
}: {
  contentId: string;
  route: ProductionRoute;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<ProductionRoute>(route);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Change route
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Change production route"
        description="Open route tasks are cancelled and the new route's tasks are created. Allowed only before production starts."
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            {PRODUCTION_ROUTES.map((r) => (
              <label
                key={r}
                className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-checked:border-foreground/60 has-checked:bg-subtle"
              >
                <input
                  type="radio"
                  name="route"
                  className="mt-0.5"
                  checked={next === r}
                  onChange={() => setNext(r)}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {PRODUCTION_ROUTE_DEFS[r].label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {PRODUCTION_ROUTE_DEFS[r].steps.map((s) => s.label).join(" → ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || next === route}
              onClick={() =>
                run(
                  () => changeRouteAction({ contentId, route: next }),
                  "Route changed",
                  () => setOpen(false),
                )
              }
            >
              Change route
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
}

// ── Versions ───────────────────────────────────────────────────────────────

export function AddVersionButton({
  contentId,
  nextNumber,
  mediaEnabled = false,
}: {
  contentId: string;
  nextNumber: number;
  /** Direct uploads (Cloudinary) are configured for this workspace. */
  mediaEnabled?: boolean;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState([{ key: 1, url: "", label: "" }]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [uploads, setUploads] = useState<UploadedFile[]>([]);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        Add V{nextNumber}
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={`Submit version ${nextNumber}`}
        description={
          mediaEnabled
            ? "Versions are permanent — a fix is always a new version. Upload the files or link them (Canva, Figma, Drive, Frame.io…)."
            : "Versions are permanent — a fix is always a new version. Link the file (Canva, Figma, Drive, Frame.io…)."
        }
      >
        <div className="flex flex-col gap-4">
          {mediaEnabled && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Upload</legend>
              <MediaUploader
                purpose="VERSION_MEDIA"
                contentId={contentId}
                accept={UPLOAD_MIME_TYPES.join(",")}
                multiple
                value={uploads}
                onChange={setUploads}
                label="Upload images, video or PDF"
              />
              <FieldError messages={errors.assetIds} />
            </fieldset>
          )}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{mediaEnabled ? "Links (optional)" : "Files / links"}</legend>
            {links.map((l, i) => (
              <div key={l.key} className="flex gap-2">
                <Input
                  value={l.url}
                  onChange={(e) =>
                    setLinks((ls) =>
                      ls.map((x) => (x.key === l.key ? { ...x, url: e.target.value } : x)),
                    )
                  }
                  placeholder="https://…"
                  type="url"
                  inputMode="url"
                  aria-label={`Link ${i + 1}`}
                  className="min-w-0"
                />
                <Input
                  value={l.label}
                  onChange={(e) =>
                    setLinks((ls) =>
                      ls.map((x) => (x.key === l.key ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  placeholder="Label"
                  aria-label={`Label ${i + 1}`}
                  className="w-28 shrink-0 sm:w-36"
                />
                {links.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove link"
                    onClick={() => setLinks((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            <FieldError messages={errors.links} />
            {links.length < MAX_VERSION_ASSETS && (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => setLinks((ls) => [...ls, { key: Date.now(), url: "", label: "" }])}
              >
                <Plus data-icon="inline-start" />
                Add another
              </Button>
            )}
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="v-caption">Caption</Label>
            <Textarea
              id="v-caption"
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-tags">Hashtags</Label>
            <Input
              id="v-tags"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#summer #skincare"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-note">
              What changed <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="v-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  async () => {
                    const res = await createVersionAction({
                      contentId,
                      links: links
                        .filter((l) => l.url.trim())
                        .map((l) => ({ url: l.url.trim(), label: l.label })),
                      assetIds: uploads.map((u) => u.assetId),
                      caption,
                      hashtags,
                      changeNote: note,
                    });
                    if (!res.ok && res.error.fieldErrors) setErrors(res.error.fieldErrors);
                    return res;
                  },
                  `V${nextNumber} submitted`,
                  () => setOpen(false),
                )
              }
            >
              {pending ? "Submitting…" : `Submit V${nextNumber}`}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
}

// ── Edit / cancel / archive ────────────────────────────────────────────────

export interface EditableContent {
  id: string;
  brandId: string;
  title: string;
  description: string | null;
  notes: string | null;
  contentType: ContentType;
  priority: ContentPriority;
  dueDate: string | null;
  references: ReferenceDTO[];
}

export function EditContentButton({ content, full }: { content: EditableContent; full: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ContentType>(content.contentType);
  const [priority, setPriority] = useState<ContentPriority>(content.priority);
  const [refs, setRefs] = useState(content.references);
  const [newRef, setNewRef] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function save(form: HTMLFormElement) {
    const fd = new FormData(form);
    run(
      async () => {
        const ids = refs.map((r) => r.id);
        if (newRef.trim()) {
          const created = await createReferenceAction({
            brandId: content.brandId,
            url: newRef.trim(),
          });
          if (!created.ok) {
            setErrors({ newRef: [created.error.fieldErrors?.url?.[0] ?? created.error.message] });
            return created;
          }
          ids.push(created.data.id);
        }
        const res = await updateContentAction({
          contentId: content.id,
          title: String(fd.get("title") ?? ""),
          description: String(fd.get("description") ?? ""),
          notes: String(fd.get("notes") ?? ""),
          contentType: type,
          priority,
          dueDate: full ? String(fd.get("dueDate") ?? "") : (content.dueDate?.slice(0, 10) ?? ""),
          referenceIds: ids,
        });
        if (!res.ok && res.error.fieldErrors) setErrors(res.error.fieldErrors);
        return res;
      },
      "Saved",
      () => setOpen(false),
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil data-icon="inline-start" />
        Edit
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Edit content">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(e.currentTarget);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="e-title">Title</Label>
            <Input
              id="e-title"
              name="title"
              defaultValue={content.title}
              aria-invalid={!!errors.title}
            />
            <FieldError messages={errors.title} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ContentType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPE_KEYS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CONTENT_TYPES[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as ContentPriority)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {CONTENT_PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {full && (
            <div className="grid gap-1.5">
              <Label htmlFor="e-due">Due date</Label>
              <Input
                id="e-due"
                name="dueDate"
                type="date"
                defaultValue={content.dueDate?.slice(0, 10) ?? ""}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="e-desc">Brief / idea</Label>
            <Textarea
              id="e-desc"
              name="description"
              rows={4}
              defaultValue={content.description ?? ""}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="e-notes">Internal notes</Label>
            <Textarea id="e-notes" name="notes" rows={2} defaultValue={content.notes ?? ""} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">References</legend>
            {refs.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{REFERENCE_PLATFORM_LABEL[r.platform]}</span>{" "}
                  <span className="text-muted-foreground">{r.title ?? r.url}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove reference"
                  onClick={() => setRefs((x) => x.filter((y) => y.id !== r.id))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Input
              value={newRef}
              onChange={(e) => setNewRef(e.target.value)}
              placeholder="Add a reference link (optional)"
              type="url"
              inputMode="url"
            />
            <FieldError messages={errors.newRef ?? errors.referenceIds} />
            <p className="text-xs text-muted-foreground">
              References come from this brand&apos;s library (max {MAX_CONTENT_REFERENCES}).
            </p>
          </fieldset>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </ResponsiveDialog>
    </>
  );
}

export function CancelContentButton({ contentId }: { contentId: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Ban data-icon="inline-start" />
        Cancel content
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this content?"
        description="Open tasks are cancelled. History, versions and references are kept."
      >
        <div className="flex flex-col gap-4">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Reason (optional)"
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(
                  () => cancelContentAction({ contentId, reason }),
                  "Content cancelled",
                  () => setOpen(false),
                )
              }
            >
              Cancel content
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
}

export function ArchiveContentButton({ contentId }: { contentId: string }) {
  const { run, pending } = useAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => run(() => archiveContentAction({ contentId }), "Archived")}
    >
      <Archive data-icon="inline-start" />
      Archive
    </Button>
  );
}
