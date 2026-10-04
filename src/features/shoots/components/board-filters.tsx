"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { BoardQuery } from "@/features/shoots/schemas";
import { addDays, formatCalendarDate } from "@/lib/dates";
import { SHOOT_STATUS_LABEL, SHOOT_STATUSES } from "@/lib/domain/shoots";
import { cn } from "@/lib/utils";

const ALL = "all";

export function BoardFilters({
  query,
  from,
  to,
  today,
  view,
  brands,
  people,
}: {
  query: BoardQuery;
  from: string;
  to: string;
  today: string;
  view: "day" | "week";
  brands: { id: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState(false);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== ALL) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  const step = view === "week" ? 7 : 1;
  const label = view === "week" ? `${formatCalendarDate(from)} – ${formatCalendarDate(to)}` : formatCalendarDate(from, { weekday: "long" });
  const active = (["brand", "status", "crew", "conflicts"] as const).filter((k) => query[k]).length;

  const selects = (
    <>
      <FilterSelect label="Brand" all="All brands" value={query.brand} onChange={(v) => update({ brand: v })} options={brands.map((b) => [b.id, b.name])} />
      <FilterSelect
        label="Status"
        all="All statuses"
        value={query.status}
        onChange={(v) => update({ status: v })}
        options={SHOOT_STATUSES.map((s) => [s, SHOOT_STATUS_LABEL[s]])}
      />
      <FilterSelect label="Crew" all="Everyone" value={query.crew} onChange={(v) => update({ crew: v })} options={people.map((p) => [p.id, p.name])} />
      <Button
        variant={query.conflicts ? "secondary" : "outline"}
        onClick={() => update({ conflicts: query.conflicts ? undefined : "1" })}
        aria-pressed={Boolean(query.conflicts)}
      >
        <AlertTriangle data-icon="inline-start" />
        Conflicts only
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => update({ date: addDays(from, -step) })}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => update({ date: addDays(from, step) })}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" onClick={() => update({ date: undefined })} disabled={from === today && view === "day"}>
            Today
          </Button>
        </div>
        <p className="order-first w-full min-w-0 truncate text-sm font-medium sm:order-none sm:w-auto sm:flex-1">
          {label}
          {pending && <Loader2 className="ml-2 inline size-4 animate-spin text-muted-foreground" />}
        </p>
        <div role="tablist" aria-label="View" className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => update({ view: v === "day" ? undefined : v })}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-3 text-sm capitalize text-muted-foreground [@media(pointer:coarse)]:h-9",
                view === v && "bg-card font-medium text-foreground shadow-sm",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <Button variant="outline" className="lg:hidden" onClick={() => setSheet(true)}>
          <SlidersHorizontal data-icon="inline-start" />
          Filters{active ? ` · ${active}` : ""}
        </Button>
      </div>
      <div className="hidden flex-wrap items-center gap-2 lg:flex">{selects}</div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="pb-safe max-h-[85dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="grid gap-3 px-4 pb-4 [&_[data-slot=select-trigger]]:w-full">
            {selects}
            <Button onClick={() => setSheet(false)}>Show shoots</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterSelect({
  label,
  all,
  value,
  onChange,
  options,
}: {
  label: string;
  all: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
}) {
  return (
    <div className="grid gap-1 lg:block">
      <Label className="text-xs text-muted-foreground lg:sr-only">{label}</Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
        <SelectTrigger className="w-full lg:w-auto lg:min-w-40" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{all}</SelectItem>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
