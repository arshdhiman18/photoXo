"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCheck, Pencil, Play, Plus, UserMinus, X } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ContentCode, contentTypeLabel } from "@/features/content/components/content-bits";
import {
  addCrewAction,
  addShootContentAction,
  cancelShootAction,
  completeCrewOnBehalfAction,
  getShootOptionsAction,
  removeCrewAction,
  removeShootContentAction,
  rescheduleShootAction,
  startShootAction,
  updateShootDetailsAction,
} from "@/features/shoots/actions";
import { ConflictList, CrewStatusBadge } from "@/features/shoots/components/shoot-bits";
import type { ConflictDTO, CrewMemberDTO, ShootAdminDTO, ShootOptionsDTO } from "@/features/shoots/types";
import type { ActionResult } from "@/lib/action-result";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";
import type { BrandRole } from "@/lib/domain/roles";
import { EDITABLE_SHOOT_STATUSES } from "@/lib/domain/shoots";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void, onError?: (r: Extract<ActionResult<unknown>, { ok: false }>) => boolean) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        if (onError?.(res)) return;
        toast.error(res.error.message);
        return;
      }
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

const conflictsOf = (r: Extract<ActionResult<unknown>, { ok: false }>) =>
  r.error.code === "CONFLICT" ? ((r.error.details as { conflicts?: ConflictDTO[] } | undefined)?.conflicts ?? null) : null;

/** Header actions, gated by status (server enforces the same rules). */
export function ShootHeaderActions({ shoot }: { shoot: ShootAdminDTO }) {
  const { run, pending } = useRun();
  const [dialog, setDialog] = useState<"edit" | "reschedule" | "cancel" | null>(null);
  const editable = EDITABLE_SHOOT_STATUSES.includes(shoot.status);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-wrap gap-2">
      {shoot.status === "SCHEDULED" && (
        <Button disabled={pending} onClick={() => run(() => startShootAction({ shootId: shoot.id }), "Shoot started")}>
          <Play data-icon="inline-start" />
          Start shoot
        </Button>
      )}
      {editable && (
        <Button variant="outline" onClick={() => setDialog("edit")}>
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      )}
      {shoot.status === "SCHEDULED" && (
        <Button variant="outline" onClick={() => setDialog("reschedule")}>
          <CalendarClock data-icon="inline-start" />
          Reschedule
        </Button>
      )}
      {editable && (
        <Button variant="outline" onClick={() => setDialog("cancel")}>
          <X data-icon="inline-start" />
          Cancel shoot
        </Button>
      )}

      {dialog === "edit" && <EditDetailsDialog shoot={shoot} onClose={close} />}
      {dialog === "reschedule" && <RescheduleDialog shoot={shoot} onClose={close} />}
      {dialog === "cancel" && (
        <ReasonDialog
          title="Cancel this shoot?"
          description="Content, crew history and tasks are kept. Linked content becomes free to schedule on another shoot."
          confirm="Cancel shoot"
          destructive
          onClose={close}
          onSubmit={(reason) => run(() => cancelShootAction({ shootId: shoot.id, reason }), "Shoot cancelled", close)}
          pending={pending}
        />
      )}
    </div>
  );
}

function EditDetailsDialog({ shoot, onClose }: { shoot: ShootAdminDTO; onClose: () => void }) {
  const { run, pending } = useRun();
  const [title, setTitle] = useState(shoot.title);
  const [notes, setNotes] = useState(shoot.notes ?? "");
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="Edit shoot">
      <div className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="e-title">Title</Label>
          <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="e-notes">Production notes</Label>
          <Textarea id="e-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => run(() => updateShootDetailsAction({ shootId: shoot.id, title, notes }), "Saved", onClose)}>
            Save
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function RescheduleDialog({ shoot, onClose }: { shoot: ShootAdminDTO; onClose: () => void }) {
  const { run, pending } = useRun();
  const [f, setF] = useState({
    date: shoot.date,
    startTime: shoot.startTime,
    endTime: shoot.endTime,
    locationName: shoot.location.name,
    locationAddress: shoot.location.address ?? "",
    reason: "",
  });
  const [conflicts, setConflicts] = useState<ConflictDTO[] | null>(null);
  const [override, setOverride] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="Reschedule shoot" description="Same shoot, crew and content — the change is kept in history.">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 grid gap-1.5 sm:col-span-1">
            <Label htmlFor="r-date">Date</Label>
            <Input id="r-date" type="date" value={f.date} onChange={set("date")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r-start">Start</Label>
            <Input id="r-start" type="time" value={f.startTime} onChange={set("startTime")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r-end">End</Label>
            <Input id="r-end" type="time" value={f.endTime} onChange={set("endTime")} aria-invalid={!!errors.endTime} />
          </div>
        </div>
        <FieldError messages={errors.endTime} />
        <div className="grid gap-1.5">
          <Label htmlFor="r-loc">Location</Label>
          <Input id="r-loc" value={f.locationName} onChange={set("locationName")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="r-addr">Address</Label>
          <Input id="r-addr" value={f.locationAddress} onChange={set("locationAddress")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="r-reason">Reason (optional)</Label>
          <Input id="r-reason" value={f.reason} onChange={set("reason")} placeholder="e.g. Client moved the slot" />
        </div>
        {conflicts && (
          <div className="rounded-lg border border-tone-danger/30 bg-tone-danger-bg/60 p-3">
            <p className="mb-2 text-sm font-medium text-tone-danger">Crew double-booked at the new time</p>
            <ConflictList conflicts={conflicts} />
            <Input className="mt-3" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Override reason (audited)" />
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => rescheduleShootAction({ shootId: shoot.id, ...f, ...(conflicts && override.trim() ? { overrideReason: override.trim() } : {}) }),
                "Shoot rescheduled",
                onClose,
                (r) => {
                  const c = conflictsOf(r);
                  if (c) {
                    setConflicts(c);
                    return true;
                  }
                  if (r.error.fieldErrors) setErrors(r.error.fieldErrors);
                  return false;
                },
              )
            }
          >
            {conflicts && override.trim() ? "Override & reschedule" : "Reschedule"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

export function ReasonDialog({
  title,
  description,
  confirm,
  destructive,
  onClose,
  onSubmit,
  pending,
}: {
  title: string;
  description?: string;
  confirm: string;
  destructive?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={title} description={description}>
      <div className="flex flex-col gap-4">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending || reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
            {confirm}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

// ── Content ────────────────────────────────────────────────────────────────

export function ShootContentPanel({ shoot }: { shoot: ShootAdminDTO }) {
  const { run, pending } = useRun();
  const [adding, setAdding] = useState(false);
  const [options, setOptions] = useState<ShootOptionsDTO | null>(null);
  const editable = EDITABLE_SHOOT_STATUSES.includes(shoot.status);

  async function openAdd() {
    setAdding(true);
    const res = await getShootOptionsAction({ brandId: shoot.brand.id, shootId: shoot.id });
    setOptions(res.ok ? res.data : { content: [], crew: [] });
  }

  return (
    <>
      {shoot.contents.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No content linked yet.</p>
      ) : (
        <ul className="divide-y">
          {shoot.contents.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <a href={`/admin/content/${c.id}`} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-sm font-medium">{c.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <ContentCode code={c.code} /> · {contentTypeLabel(c.contentType)}
                  {c.hasReferences && " · Reference"}
                </span>
              </a>
              {editable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${c.title} from this shoot`}
                  disabled={pending}
                  onClick={() => run(() => removeShootContentAction({ shootId: shoot.id, contentId: c.id }), "Removed from shoot (content kept)")}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="border-t px-4 py-2.5 sm:px-5">
          <Button variant="ghost" size="sm" onClick={openAdd}>
            <Plus data-icon="inline-start" />
            Add content
          </Button>
        </div>
      )}
      {adding && (
        <ResponsiveDialog open onOpenChange={setAdding} title="Add content to this shoot">
          {options === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : options.content.filter((c) => !c.attached).length === 0 ? (
            <p className="text-sm text-muted-foreground">No other eligible content for this brand.</p>
          ) : (
            <ul className="grid max-h-[60dvh] gap-2 overflow-y-auto">
              {options.content
                .filter((c) => !c.attached)
                .map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        <ContentCode code={c.code} /> · {contentTypeLabel(c.contentType)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => addShootContentAction({ shootId: shoot.id, contentId: c.id }), "Added to shoot", () => setAdding(false))}
                    >
                      Add
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </ResponsiveDialog>
      )}
    </>
  );
}

// ── Crew ───────────────────────────────────────────────────────────────────

export function ShootCrewPanel({ shoot }: { shoot: ShootAdminDTO }) {
  const { run, pending } = useRun();
  const [behalf, setBehalf] = useState<CrewMemberDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const editable = EDITABLE_SHOOT_STATUSES.includes(shoot.status);
  const started = shoot.status === "IN_PROGRESS" || shoot.status === "PARTIALLY_COMPLETED";
  const visible = shoot.crew.filter((c) => c.status !== "CANCELLED");
  const removed = shoot.crew.filter((c) => c.status === "CANCELLED");

  return (
    <>
      {visible.length === 0 ? (
        <p className="px-4 py-4 text-sm text-tone-warning sm:px-5">No crew yet — add crew before the shoot can start.</p>
      ) : (
        <ul className="divide-y">
          {visible.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
              <UserAvatar name={c.name} image={c.image} seed={c.userId} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {BRAND_ROLE_LABEL[c.brandRole]}
                  {!c.required && " · optional"}
                  {c.completedOnBehalf && " · marked by a manager"}
                </p>
              </div>
              <CrewStatusBadge status={c.status} />
              {started && c.status !== "COMPLETED" && (
                <Button variant="outline" size="sm" onClick={() => setBehalf(c)}>
                  <CheckCheck data-icon="inline-start" />
                  Mark done
                </Button>
              )}
              {editable && c.status !== "COMPLETED" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${c.name} from crew`}
                  disabled={pending}
                  onClick={() => run(() => removeCrewAction({ shootId: shoot.id, crewId: c.id }), `${c.name.split(" ")[0]} removed from crew`)}
                >
                  <UserMinus />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removed.length > 0 && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground sm:px-5">
          Removed: {removed.map((c) => c.name).join(", ")}
        </p>
      )}
      {editable && (
        <div className="border-t px-4 py-2.5 sm:px-5">
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add crew
          </Button>
        </div>
      )}
      {behalf && (
        <ReasonDialog
          title={`Mark ${behalf.name.split(" ")[0]}'s part done?`}
          description="Use when they finished but couldn't update it themselves. Recorded as done by you, with your reason."
          confirm="Mark done"
          onClose={() => setBehalf(null)}
          pending={pending}
          onSubmit={(reason) =>
            run(() => completeCrewOnBehalfAction({ shootId: shoot.id, crewId: behalf.id, reason }), "Marked done", () => setBehalf(null))
          }
        />
      )}
      {adding && <AddCrewDialog shoot={shoot} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddCrewDialog({ shoot, onClose }: { shoot: ShootAdminDTO; onClose: () => void }) {
  const { run, pending } = useRun();
  const [options, setOptions] = useState<ShootOptionsDTO | null>(null);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<BrandRole | "">("");
  const [required, setRequired] = useState(true);
  const [conflicts, setConflicts] = useState<ConflictDTO[] | null>(null);
  const [override, setOverride] = useState("");

  useEffect(() => {
    let live = true;
    void getShootOptionsAction({ brandId: shoot.brand.id, shootId: shoot.id }).then((r) => {
      if (live) setOptions(r.ok ? r.data : { content: [], crew: [] });
    });
    return () => {
      live = false;
    };
  }, [shoot.brand.id, shoot.id]);
  const onCrew = new Set(shoot.crew.filter((c) => c.status !== "CANCELLED").map((c) => c.userId));
  const candidates = (options?.crew ?? []).filter((c) => !onCrew.has(c.userId));
  const roles = candidates.find((c) => c.userId === userId)?.roles ?? [];

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="Add crew" description="Active brand members with a shoot role.">
      <div className="flex flex-col gap-4">
        {options === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everyone eligible is already on this shoot.</p>
        ) : (
          <>
            <Select
              value={userId}
              onValueChange={(v) => {
                setUserId(v);
                setRole(candidates.find((c) => c.userId === v)?.roles[0] ?? "");
                setConflicts(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.userId} value={c.userId}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {userId && (
              <div className="flex flex-wrap items-center gap-3">
                <Select value={role} onValueChange={(v) => setRole(v as BrandRole)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {BRAND_ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                  Required for completion
                </label>
              </div>
            )}
          </>
        )}
        {conflicts && (
          <div className="rounded-lg border border-tone-danger/30 bg-tone-danger-bg/60 p-3">
            <p className="mb-2 text-sm font-medium text-tone-danger">Double-booked</p>
            <ConflictList conflicts={conflicts} />
            <Input className="mt-3" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Override reason (audited)" />
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !userId || !role}
            onClick={() =>
              run(
                () =>
                  addCrewAction({
                    shootId: shoot.id,
                    userId,
                    brandRole: role as BrandRole,
                    required,
                    ...(conflicts && override.trim() ? { overrideReason: override.trim() } : {}),
                  } as Parameters<typeof addCrewAction>[0]),
                "Crew added",
                onClose,
                (r) => {
                  const c = conflictsOf(r);
                  if (c) setConflicts(c);
                  return Boolean(c);
                },
              )
            }
          >
            {conflicts && override.trim() ? "Override & add" : "Add to crew"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
