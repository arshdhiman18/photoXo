"use client";

import { useState, useTransition } from "react";
import { PlatformPicker } from "@/features/postings/components/platform-picker";
import type { PostingPlatform } from "@/lib/domain/postings";
import { useRouter } from "next/navigation";
import { Lightbulb, Plus } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
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
import { createBriefAction, createIdeaAction } from "@/features/content/actions";
import { createBriefSchema, createIdeaSchema } from "@/features/content/schemas";
import {
  CONTENT_PRIORITIES,
  CONTENT_PRIORITY_LABEL,
  CONTENT_TYPE_KEYS,
  CONTENT_TYPES,
  PRODUCTION_ROUTE_DEFS,
  PRODUCTION_ROUTES,
  type ContentType,
  type ProductionRoute,
} from "@/lib/domain/content";

type Mode = "brief" | "idea";
type Errors = Record<string, string[]>;

/**
 * Create content. `brief` (admin/manager): origin Brief or Reference, route,
 * due date → PLANNED. `idea` (employee): brand limited to their brands, no
 * route/due date, reference optional → PROPOSED for review.
 */
export function ContentFormDialog({
  open,
  onOpenChange,
  mode,
  brands,
  defaultBrandId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: Mode;
  brands: { id: string; name: string }[];
  defaultBrandId?: string;
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [brandId, setBrandId] = useState(
    defaultBrandId ?? (brands.length === 1 ? brands[0]!.id : ""),
  );
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [route, setRoute] = useState<ProductionRoute | "">("");
  const [origin, setOrigin] = useState<"ADMIN_BRIEF" | "REFERENCE">("ADMIN_BRIEF");
  const [priority, setPriority] = useState("NORMAL");
  const [platforms, setPlatforms] = useState<PostingPlatform[]>([]);

  const effectiveRoute = route || (contentType ? CONTENT_TYPES[contentType].defaultRoute : "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const common = {
      brandId,
      title: String(fd.get("title") ?? ""),
      description: String(fd.get("description") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      contentType,
      priority,
      referenceUrl: String(fd.get("referenceUrl") ?? ""),
    };
    const input =
      mode === "brief"
        ? {
            ...common,
            origin,
            route: effectiveRoute || undefined,
            dueDate: String(fd.get("dueDate") ?? ""),
            targetPlatforms: platforms,
          }
        : common;
    const parsed = (mode === "brief" ? createBriefSchema : createIdeaSchema).safeParse(input);
    if (!parsed.success) {
      const fe: Errors = {};
      for (const i of parsed.error.issues) (fe[String(i.path[0])] ??= []).push(i.message);
      setErrors(fe);
      return;
    }
    if (mode === "brief" && origin === "REFERENCE" && !common.referenceUrl) {
      setErrors({ referenceUrl: ["Add the reference link"] });
      return;
    }
    setErrors({});
    start(async () => {
      const res =
        mode === "brief"
          ? await createBriefAction(input as Parameters<typeof createBriefAction>[0])
          : await createIdeaAction(input as Parameters<typeof createIdeaAction>[0]);
      if (!res.ok) {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        else toast.error(res.error.message);
        return;
      }
      toast.success(
        mode === "brief" ? `${res.data.code} created` : `Idea ${res.data.code} sent for review`,
      );
      onOpenChange(false);
      if (onCreated) onCreated(res.data.id);
      else router.refresh();
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "brief" ? "New content brief" : "Add an idea"}
      description={
        mode === "brief"
          ? "Planned content gets its production tasks from the route."
          : "Your idea goes to a manager for review. A reference is optional."
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-brand">Brand</Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger id="cf-brand" className="w-full" aria-invalid={!!errors.brandId}>
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
            <FieldError messages={errors.brandId ? ["Choose a brand"] : undefined} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-type">Content type</Label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
              <SelectTrigger id="cf-type" className="w-full" aria-invalid={!!errors.contentType}>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPE_KEYS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CONTENT_TYPES[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError messages={errors.contentType} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cf-title">Title</Label>
          <Input
            id="cf-title"
            name="title"
            placeholder="e.g. Summer transition reel"
            aria-invalid={!!errors.title}
            autoComplete="off"
          />
          <FieldError messages={errors.title} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cf-description">{mode === "brief" ? "Brief" : "Idea"}</Label>
          <Textarea
            id="cf-description"
            name="description"
            rows={4}
            placeholder={
              mode === "brief"
                ? "What to make, key messages, must-haves…"
                : "Describe the idea, the hook, the look…"
            }
            aria-invalid={!!errors.description}
          />
          <FieldError messages={errors.description} />
        </div>

        {mode === "brief" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Origin</Label>
              <Select value={origin} onValueChange={(v) => setOrigin(v as typeof origin)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN_BRIEF">Brief</SelectItem>
                  <SelectItem value="REFERENCE">Recreate a reference</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Production route</Label>
              <Select
                value={effectiveRoute}
                onValueChange={(v) => setRoute(v as ProductionRoute)}
                disabled={!contentType}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a type first" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCTION_ROUTES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {PRODUCTION_ROUTE_DEFS[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {effectiveRoute && (
                <p className="text-xs text-muted-foreground">
                  {PRODUCTION_ROUTE_DEFS[effectiveRoute].description}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="cf-ref">
            Reference link{" "}
            <span className="font-normal text-muted-foreground">
              {mode === "brief" && origin === "REFERENCE" ? "(required)" : "(optional)"}
            </span>
          </Label>
          <Input
            id="cf-ref"
            name="referenceUrl"
            type="url"
            inputMode="url"
            placeholder="Instagram, YouTube, TikTok, Pinterest or any link"
            aria-invalid={!!errors.referenceUrl}
          />
          <FieldError messages={errors.referenceUrl} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
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
          {mode === "brief" && (
            <div className="grid gap-1.5">
              <Label htmlFor="cf-due">
                Due date <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="cf-due" name="dueDate" type="date" aria-invalid={!!errors.dueDate} />
              <FieldError messages={errors.dueDate} />
            </div>
          )}
        </div>

        {mode === "brief" && (
          <div className="grid gap-1.5">
            <Label htmlFor="cf-platforms">
              Post to <span className="font-normal text-muted-foreground">(needed before internal approval)</span>
            </Label>
            <PlatformPicker id="cf-platforms" value={platforms} onChange={setPlatforms} />
            <FieldError messages={errors.targetPlatforms} />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="cf-notes">
            Internal notes{" "}
            <span className="font-normal text-muted-foreground">(never shown to clients)</span>
          </Label>
          <Textarea id="cf-notes" name="notes" rows={2} />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : mode === "brief" ? "Create brief" : "Submit idea"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export function NewBriefButton({
  brands,
  variant = "default",
}: {
  brands: { id: string; name: string }[];
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} disabled={brands.length === 0}>
        <Plus data-icon="inline-start" />
        New brief
      </Button>
      {open && (
        <ContentFormDialog
          open={open}
          onOpenChange={setOpen}
          mode="brief"
          brands={brands}
          onCreated={(id) => router.push(`/admin/content/${id}`)}
        />
      )}
    </>
  );
}

export function AddIdeaButton({
  brands,
  className,
  defaultBrandId,
}: {
  brands: { id: string; name: string }[];
  className?: string;
  defaultBrandId?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={brands.length === 0} className={className}>
        <Lightbulb data-icon="inline-start" />
        Add idea
      </Button>
      {open && (
        <ContentFormDialog
          open={open}
          onOpenChange={setOpen}
          mode="idea"
          brands={brands}
          defaultBrandId={defaultBrandId}
          onCreated={(id) => router.push(`/work/content/${id}`)}
        />
      )}
    </>
  );
}
