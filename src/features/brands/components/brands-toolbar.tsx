"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { BrandListQuery } from "@/features/brands/schemas";
import { cn } from "@/lib/utils";

export function BrandsToolbar({
  query,
  counts,
}: {
  query: BrandListQuery;
  counts: { ACTIVE: number; ARCHIVED: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const first = useRef(true);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => update({ q: q.trim() || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the input value
  }, [q]);

  const status = query.status ?? "ACTIVE";
  const tabs = [
    { value: "ACTIVE", label: "Active", count: counts.ACTIVE },
    { value: "ARCHIVED", label: "Archived", count: counts.ARCHIVED },
    { value: "ALL", label: "All", count: counts.ACTIVE + counts.ARCHIVED },
  ] as const;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div
        role="tablist"
        aria-label="Filter by status"
        className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={status === t.value}
            onClick={() => update({ status: t.value === "ACTIVE" ? undefined : t.value })}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [@media(pointer:coarse)]:h-9",
              status === t.value && "bg-card font-medium text-foreground shadow-sm",
            )}
          >
            {t.label}
            <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brands"
          aria-label="Search brands"
          className="pr-8 pl-8"
        />
        {pending && (
          <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
