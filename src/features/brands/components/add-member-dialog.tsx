"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { ToneBadge } from "@/components/common/tone-badge";
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
import { addMemberAction, searchMemberCandidatesAction } from "@/features/brands/actions";
import type { MemberCandidateDTO } from "@/features/brands/types";
import {
  BRAND_ROLE_ALLOWED_SYSTEM_ROLES,
  BRAND_ROLE_LABEL,
  BRAND_ROLE_ORDER,
} from "@/lib/domain/brands";
import { SYSTEM_ROLE_LABEL, type BrandRole } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

/**
 * Assign a person to a brand role. Candidates are searched server-side and
 * already filtered by the explicit system-role ↔ brand-role rules, so
 * incompatible combinations (client → videographer, staff → client) are never
 * offered — and the server refuses them anyway.
 */
export function AddMemberDialog({
  open,
  onOpenChange,
  brandId,
  brandName,
  initialRole,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  brandName: string;
  initialRole: BrandRole | null;
}) {
  const router = useRouter();
  const [role, setRole] = useState<BrandRole | undefined>(initialRole ?? undefined);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemberCandidateDTO[] | null>(null);
  const [selected, setSelected] = useState<MemberCandidateDTO | null>(null);
  /** Extra roles to give the same person in one go (e.g. videographer + editor). */
  const [extra, setExtra] = useState<BrandRole[]>([]);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (!role) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const res = await searchMemberCandidatesAction({ brandId, role, q: q.trim() });
        if (!res.ok) {
          toast.error(res.error.message);
          setResults([]);
          return;
        }
        setResults(res.data);
        setSelected((s) => (s && res.data.some((c) => c.id === s.id) ? s : null));
      });
    }, 200);
    return () => clearTimeout(t);
  }, [brandId, role, q]);

  const extraOptions =
    role && selected
      ? BRAND_ROLE_ORDER.filter(
          (r) => r !== role && BRAND_ROLE_ALLOWED_SYSTEM_ROLES[r].includes(selected.systemRole),
        )
      : [];

  function assign() {
    if (!role || !selected) return;
    const roles = [role, ...extra.filter((r) => extraOptions.includes(r))];
    startSave(async () => {
      const added: string[] = [];
      for (const r of roles) {
        const res = await addMemberAction({ brandId, userId: selected.id, role: r });
        if (res.ok) added.push(BRAND_ROLE_LABEL[r]);
        else if (!/already/i.test(res.error.message)) {
          toast.error(`${BRAND_ROLE_LABEL[r]}: ${res.error.message}`);
        }
      }
      if (added.length) toast.success(`${selected.name.split(" ")[0]} added as ${added.join(", ")}`);
      else toast.info(`${selected.name.split(" ")[0]} already has ${roles.length > 1 ? "these roles" : "this role"} here`);
      onOpenChange(false);
      setExtra([]);
      router.refresh();
    });
  }

  const allowed = role
    ? BRAND_ROLE_ALLOWED_SYSTEM_ROLES[role].map((r) => SYSTEM_ROLE_LABEL[r]).join(", ")
    : "";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Add to ${brandName}`}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="member-role">Brand role</Label>
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v as BrandRole);
              setSelected(null);
              setResults(null);
              setExtra([]);
            }}
          >
            <SelectTrigger id="member-role" className="w-full">
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
              {BRAND_ROLE_ORDER.map((r) => (
                <SelectItem key={r} value={r}>
                  {BRAND_ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {role && (
            <p className="text-xs text-muted-foreground">Available to: {allowed} accounts.</p>
          )}
        </div>

        {role && (
          <div className="grid gap-1.5">
            <Label htmlFor="member-search">Person</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="member-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or email"
                className="pr-8 pl-8"
                autoComplete="off"
              />
              {searching && (
                <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            <div
              className="max-h-64 overflow-y-auto rounded-lg border"
              role="listbox"
              aria-label="People"
            >
              {results === null ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-pretty text-muted-foreground">
                  {q ? "No matching people." : "Everyone eligible already has this role here."} Only{" "}
                  {allowed} accounts can be {BRAND_ROLE_LABEL[role]}.
                </p>
              ) : (
                <ul className="divide-y">
                  {results.map((c) => {
                    const active = selected?.id === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => setSelected(c)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-subtle focus-visible:bg-subtle [@media(pointer:coarse)]:py-3",
                            active && "bg-accent",
                          )}
                        >
                          <UserAvatar
                            name={c.name}
                            image={c.image}
                            seed={c.id}
                            className="size-7"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <span className="truncate">{c.name}</span>
                              {c.userStatus === "INVITED" && (
                                <ToneBadge tone="info">Invited</ToneBadge>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.email} · {SYSTEM_ROLE_LABEL[c.systemRole]}
                            </span>
                          </span>
                          {active && <Check className="size-4 shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {extraOptions.length > 0 && (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">
              Also add {selected!.name.split(" ")[0]} as{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {extraOptions.map((r) => {
                const on = extra.includes(r);
                return (
                  <label
                    key={r}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm [@media(pointer:coarse)]:py-2.5",
                      on && "border-foreground/30 bg-accent",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setExtra((x) => (on ? x.filter((y) => y !== r) : [...x, r]))}
                      className="size-4 accent-foreground"
                    />
                    <span className="truncate">{BRAND_ROLE_LABEL[r]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={assign} disabled={!role || !selected || saving}>
            {saving ? "Adding…" : extra.length ? `Add with ${extra.length + 1} roles` : "Add to brand"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
