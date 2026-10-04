"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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
import { createBrandAction, updateBrandAction } from "@/features/brands/actions";
import { createBrandSchema } from "@/features/brands/schemas";
import type { BrandDetailDTO } from "@/features/brands/types";
import {
  MAX_SOCIAL_HANDLES,
  SOCIAL_PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from "@/lib/domain/brands";

type HandleRow = {
  key: number;
  platform: SocialPlatform;
  url: string;
  handle: string;
  label: string;
};
type Errors = Record<string, string[]>;

let rowKey = 0;
const newRow = (p: Partial<HandleRow> = {}): HandleRow => ({
  key: ++rowKey,
  platform: "INSTAGRAM",
  url: "",
  handle: "",
  label: "",
  ...p,
});

/** Create (no `brand`) or edit (with `brand`) a brand. */
export function BrandFormDialog({
  open,
  onOpenChange,
  brand,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brand?: BrandDetailDTO;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [handles, setHandles] = useState<HandleRow[]>(() =>
    (brand?.socialHandles ?? []).map((h) =>
      newRow({ platform: h.platform, url: h.url, handle: h.handle ?? "", label: h.label ?? "" }),
    ),
  );
  const [status, setStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const editing = Boolean(brand);

  function update(key: number, patch: Partial<HandleRow>) {
    setHandles((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
      logoUrl: String(fd.get("logoUrl") ?? ""),
      socialHandles: handles.map(({ platform, url, handle, label }) => ({
        platform,
        url,
        handle,
        label: platform === "OTHER" ? label : "",
      })),
      ...(editing ? {} : { status }),
    };
    const parsed = createBrandSchema.safeParse({ ...input, status });
    if (!parsed.success) {
      const fe: Errors = {};
      for (const i of parsed.error.issues) (fe[i.path.join(".")] ??= []).push(i.message);
      setErrors(fe);
      return;
    }
    setErrors({});
    start(async () => {
      const res = editing
        ? await updateBrandAction({ ...input, brandId: brand!.id })
        : await createBrandAction({ ...input, status });
      if (!res.ok) {
        if (res.error.code === "CONFLICT") setErrors({ name: [res.error.message] });
        else if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        else toast.error(res.error.message);
        return;
      }
      onOpenChange(false);
      if (editing) {
        toast.success("Brand updated");
        router.refresh();
      } else {
        toast.success(`${input.name.trim()} created`);
        router.push(`/admin/brands/${(res.data as { id: string }).id}`);
      }
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit brand" : "New brand"}
      description={editing ? undefined : "You can assign the team after creating the brand."}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="brand-name">Brand name</Label>
          <Input
            id="brand-name"
            name="name"
            defaultValue={brand?.name}
            placeholder="e.g. Mamaearth"
            aria-invalid={!!errors.name}
            autoComplete="off"
          />
          <FieldError messages={errors.name} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="brand-logo">
            Logo URL <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="brand-logo"
            name="logoUrl"
            type="url"
            inputMode="url"
            defaultValue={brand?.logoUrl ?? ""}
            placeholder="https://…/logo.png"
            aria-invalid={!!errors.logoUrl}
          />
          <FieldError messages={errors.logoUrl} />
          <p className="text-xs text-muted-foreground">
            Paste a link to a hosted image (square works best).
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="brand-description">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="brand-description"
            name="description"
            rows={3}
            defaultValue={brand?.description ?? ""}
            placeholder="What the brand is, tone of voice, key products…"
            aria-invalid={!!errors.description}
          />
          <FieldError messages={errors.description} />
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Social handles</legend>
          {handles.length === 0 && (
            <p className="text-sm text-muted-foreground">No social handles added.</p>
          )}
          {handles.map((h, i) => (
            <div key={h.key} className="grid gap-2 rounded-lg border bg-subtle p-2.5">
              <div className="flex gap-2">
                <Select
                  value={h.platform}
                  onValueChange={(v) => update(h.key, { platform: v as SocialPlatform })}
                >
                  <SelectTrigger className="w-36 shrink-0 bg-card" aria-label="Platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {SOCIAL_PLATFORM_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={h.handle}
                  onChange={(e) => update(h.key, { handle: e.target.value })}
                  placeholder="@handle (optional)"
                  aria-label="Handle"
                  className="min-w-0 bg-card"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove handle"
                  onClick={() => setHandles((rows) => rows.filter((r) => r.key !== h.key))}
                >
                  <Trash2 />
                </Button>
              </div>
              {h.platform === "OTHER" && (
                <Input
                  value={h.label}
                  onChange={(e) => update(h.key, { label: e.target.value })}
                  placeholder="Platform name, e.g. Threads"
                  aria-label="Platform name"
                  className="bg-card"
                />
              )}
              <Input
                value={h.url}
                onChange={(e) => update(h.key, { url: e.target.value })}
                type="url"
                inputMode="url"
                placeholder="https://…"
                aria-label="Profile link"
                aria-invalid={!!errors[`socialHandles.${i}.url`]}
                className="bg-card"
              />
              <FieldError
                messages={errors[`socialHandles.${i}.url`] ?? errors[`socialHandles.${i}.platform`]}
              />
            </div>
          ))}
          {handles.length < MAX_SOCIAL_HANDLES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setHandles((r) => [...r, newRow()])}
            >
              <Plus data-icon="inline-start" />
              Add social handle
            </Button>
          )}
        </fieldset>

        {!editing && (
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "ARCHIVED")}>
              <SelectTrigger className="w-full" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create brand"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export function NewBrandButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        New brand
      </Button>
      {open && <BrandFormDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
