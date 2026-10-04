"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamListQuery } from "@/features/team/schemas";
import {
  SYSTEM_ROLES,
  SYSTEM_ROLE_LABEL,
  USER_STATUS_LABEL,
  type UserStatus,
} from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

const ALL = "all";
const STATUS_TAB_ORDER: UserStatus[] = ["ACTIVE", "INVITED", "SUSPENDED", "DEACTIVATED"];

export function TeamToolbar({
  query,
  statusCounts,
}: {
  query: TeamListQuery;
  statusCounts: Partial<Record<UserStatus, number>>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const firstRender = useRef(true);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page"); // any filter change resets pagination
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // Debounced search.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => update({ q: q.trim() || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the input value
  }, [q]);

  const total = Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0);
  const tabs: { value: UserStatus | undefined; label: string; count: number }[] = [
    { value: undefined, label: "All", count: total },
    ...STATUS_TAB_ORDER.map((s) => ({
      value: s,
      label: USER_STATUS_LABEL[s],
      count: statusCounts[s] ?? 0,
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Status segments: scroll inside their own container on narrow screens. */}
      <div className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          role="tablist"
          aria-label="Filter by status"
          className="inline-flex gap-1 rounded-lg bg-muted p-1"
        >
          {tabs.map((t) => {
            const active = query.status === t.value;
            return (
              <button
                key={t.label}
                role="tab"
                aria-selected={active}
                onClick={() => update({ status: t.value })}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [@media(pointer:coarse)]:h-9",
                  active && "bg-card font-medium text-foreground shadow-sm",
                )}
              >
                {t.label}
                <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search team"
            className="pr-8 pl-8"
          />
          {pending ? (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )
          )}
        </div>
        <Select
          value={query.role ?? ALL}
          onValueChange={(v) => update({ role: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            {SYSTEM_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {SYSTEM_ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(query.q || query.role || query.status) && (
          <Button
            variant="ghost"
            className="self-start sm:self-auto"
            onClick={() => {
              setQ("");
              start(() => router.replace(pathname, { scroll: false }));
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
