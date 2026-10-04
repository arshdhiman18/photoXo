"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ContentCode, ContentStatusBadge, contentTypeLabel } from "@/features/content/components/content-bits";
import { createShootAction, getShootOptionsAction } from "@/features/shoots/actions";
import { ConflictList } from "@/features/shoots/components/shoot-bits";
import type { ConflictDTO, ShootOptionsDTO } from "@/features/shoots/types";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";
import { PRODUCTION_ROUTE_DEFS } from "@/lib/domain/content";
import type { BrandRole } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

type Errors = Record<string, string[]>;
type CrewPick = { role: BrandRole; required: boolean };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function ShootForm({
  brands,
  defaultBrandId,
  defaultDate,
}: {
  brands: { id: string; name: string }[];
  defaultBrandId?: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(defaultBrandId ?? "");
  const [options, setOptions] = useState<ShootOptionsDTO | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [content, setContent] = useState<string[]>([]);
  const [crew, setCrew] = useState<Record<string, CrewPick>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [conflicts, setConflicts] = useState<ConflictDTO[] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    if (!brandId) return;
    startLoading(async () => {
      const res = await getShootOptionsAction({ brandId });
      setOptions(res.ok ? res.data : { content: [], crew: [] });
      setContent([]);
      setCrew({});
      setConflicts(null);
    });
  }, [brandId]);

  function toggleCrew(userId: string, roles: BrandRole[]) {
    setCrew((c) => {
      const next = { ...c };
      if (next[userId]) delete next[userId];
      else next[userId] = { role: roles[0]!, required: true };
      return next;
    });
  }

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    const input = {
      brandId,
      title: String(fd.get("title") ?? ""),
      date: String(fd.get("date") ?? ""),
      startTime: String(fd.get("startTime") ?? ""),
      endTime: String(fd.get("endTime") ?? ""),
      locationName: String(fd.get("locationName") ?? ""),
      locationAddress: String(fd.get("locationAddress") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      contentIds: content,
      crew: Object.entries(crew).map(([userId, p]) => ({ userId, brandRole: p.role, required: p.required })),
      ...(conflicts && overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
    };
    startSaving(async () => {
      const res = await createShootAction(input as Parameters<typeof createShootAction>[0]);
      if (!res.ok) {
        const details = res.error.details as { conflicts?: ConflictDTO[] } | undefined;
        if (res.error.code === "CONFLICT" && details?.conflicts) {
          setConflicts(details.conflicts);
          toast.warning("Crew double-booked — review below");
          return;
        }
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success("Shoot scheduled");
      router.push(`/admin/shoots/${res.data.id}`);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <Section title="When & where">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Brand</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger className="w-full" aria-invalid={!!errors.brandId}>
                  <SelectValue placeholder="Choose a brand" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-title">Title</Label>
              <Input id="s-title" name="title" placeholder="e.g. Monsoon range studio shoot" aria-invalid={!!errors.title} />
              <FieldError messages={errors.title} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="s-date">Date</Label>
              <Input id="s-date" name="date" type="date" defaultValue={defaultDate} aria-invalid={!!errors.date} />
              <FieldError messages={errors.date} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-start">Start</Label>
              <Input id="s-start" name="startTime" type="time" defaultValue="10:00" step={900} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-end">End</Label>
              <Input id="s-end" name="endTime" type="time" defaultValue="13:00" step={900} aria-invalid={!!errors.endTime} />
            </div>
            <FieldError messages={errors.endTime} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="s-loc">Location</Label>
              <Input id="s-loc" name="locationName" placeholder="e.g. Gurgaon Studio" aria-invalid={!!errors.locationName} />
              <FieldError messages={errors.locationName} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-addr">
                Address <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="s-addr" name="locationAddress" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-notes">Production notes</Label>
            <Textarea id="s-notes" name="notes" rows={2} placeholder="Call time, props, parking…" />
          </div>
        </div>
      </Section>

      <Section title="Content to shoot" hint="Only this brand's planned content on a route with a shoot, not already on another active shoot.">
        {!brandId ? (
          <p className="text-sm text-muted-foreground">Choose a brand first.</p>
        ) : loading || !options ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : options.content.length === 0 ? (
          <p className="text-sm text-muted-foreground">No eligible content. Create a Reel/Video/Photo brief for this brand first.</p>
        ) : (
          <ul className="grid gap-2">
            {options.content.map((c) => {
              const checked = content.includes(c.id);
              return (
                <li key={c.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-subtle [@media(pointer:coarse)]:py-3",
                      checked && "border-foreground/50 bg-subtle",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={checked}
                      onChange={() => setContent((x) => (checked ? x.filter((i) => i !== c.id) : [...x, c.id]))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <ContentCode code={c.code} /> · {contentTypeLabel(c.contentType)} · {PRODUCTION_ROUTE_DEFS[c.route].label}
                        {c.hasReferences && <span className="text-tone-info">· Reference</span>}
                      </span>
                    </span>
                    <ContentStatusBadge status={c.status} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Crew" hint="Active members of this brand with a shoot role. Optional crew don't block completion.">
        {!brandId || !options ? (
          <p className="text-sm text-muted-foreground">{brandId ? "Loading…" : "Choose a brand first."}</p>
        ) : options.crew.length === 0 ? (
          <p className="text-sm text-muted-foreground">No eligible crew. Assign videographers/photographers on the brand&apos;s Team tab.</p>
        ) : (
          <ul className="grid gap-2">
            {options.crew.map((p) => {
              const pick = crew[p.userId];
              return (
                <li key={p.userId} className={cn("rounded-lg border px-3 py-2.5", pick && "border-foreground/50 bg-subtle")}>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input type="checkbox" className="size-4" checked={Boolean(pick)} onChange={() => toggleCrew(p.userId, p.roles)} />
                      <UserAvatar name={p.name} image={p.image} seed={p.userId} className="size-7" />
                      <span className="truncate text-sm font-medium">{p.name}</span>
                    </label>
                    {pick && (
                      <div className="flex items-center gap-2">
                        <Select
                          value={pick.role}
                          onValueChange={(v) => setCrew((c) => ({ ...c, [p.userId]: { ...pick, role: v as BrandRole } }))}
                        >
                          <SelectTrigger size="sm" className="w-36" aria-label={`${p.name}'s role`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {p.roles.map((r) => (
                              <SelectItem key={r} value={r}>
                                {BRAND_ROLE_LABEL[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={pick.required}
                            onChange={(e) => setCrew((c) => ({ ...c, [p.userId]: { ...pick, required: e.target.checked } }))}
                          />
                          Required
                        </label>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {conflicts && (
        <section className="rounded-xl border border-tone-danger/30 bg-tone-danger-bg/60 p-4 sm:p-5" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-medium text-tone-danger">
            <AlertTriangle className="size-4" /> Crew double-booked
          </p>
          <div className="mt-2">
            <ConflictList conflicts={conflicts} />
          </div>
          <div className="mt-3 grid gap-1.5">
            <Label htmlFor="override">Schedule anyway — reason (audited)</Label>
            <Input id="override" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. Rahul only covers the first hour" />
            <p className="text-xs text-muted-foreground">Or change the time/crew above and submit again.</p>
          </div>
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !brandId || (Boolean(conflicts) && overrideReason.trim().length > 0 && overrideReason.trim().length < 3)}>
          {saving ? "Scheduling…" : conflicts && overrideReason.trim() ? "Override & schedule" : "Schedule shoot"}
        </Button>
      </div>
    </form>
  );
}
