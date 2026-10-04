"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lightbulb, Loader2, Search, SlidersHorizontal } from "lucide-react";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ContentListQuery } from "@/features/content/schemas";
import {
  CONTENT_ORIGIN_LABEL,
  CONTENT_ORIGINS,
  CONTENT_STATUS_LABEL,
  CONTENT_STATUSES,
  CONTENT_TYPE_KEYS,
  CONTENT_TYPES,
  CONTENT_PRIORITIES,
  CONTENT_PRIORITY_LABEL,
} from "@/lib/domain/content";
import { cn } from "@/lib/utils";

const ALL = "all";
type Key = "brand" | "type" | "status" | "origin" | "created" | "archived" | "priority" | "due" | "assignee";

export function ContentFilters({
  query,
  brands,
  people = [],
  ideasPending,
}: {
  query: ContentListQuery;
  brands: { id: string; name: string }[];
  /** Assignee filter options (production team). */
  people?: { id: string; name: string }[];
  ideasPending: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const [sheet, setSheet] = useState(false);
  const first = useRef(true);

  function update(patch: Partial<Record<Key | "q", string | undefined>>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== ALL) next.set(k, v);
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

  const active = (["brand", "type", "status", "origin", "created", "archived", "priority", "due", "assignee"] as const).filter(
    (k) => query[k],
  ).length;

  const selects = (
    <>
      <FilterSelect
        label="Brand"
        allLabel="All brands"
        value={query.brand}
        onChange={(v) => update({ brand: v })}
        options={brands.map((b) => [b.id, b.name])}
      />
      <FilterSelect
        label="Status"
        allLabel="All statuses"
        value={query.status}
        onChange={(v) => update({ status: v })}
        options={CONTENT_STATUSES.map((s) => [s, CONTENT_STATUS_LABEL[s]])}
      />
      <FilterSelect
        label="Type"
        allLabel="All types"
        value={query.type}
        onChange={(v) => update({ type: v })}
        options={CONTENT_TYPE_KEYS.map((t) => [t, CONTENT_TYPES[t].label])}
      />
      <FilterSelect
        label="Origin"
        allLabel="All origins"
        value={query.origin}
        onChange={(v) => update({ origin: v })}
        options={CONTENT_ORIGINS.map((o) => [o, CONTENT_ORIGIN_LABEL[o]])}
      />
      <FilterSelect
        label="Created"
        value={query.created}
        onChange={(v) => update({ created: v })}
        options={[
          ["7d", "Last 7 days"],
          ["30d", "Last 30 days"],
          ["90d", "Last 90 days"],
        ]}
        allLabel="Any time"
      />
      <FilterSelect
        label="Priority"
        allLabel="Any priority"
        value={query.priority}
        onChange={(v) => update({ priority: v })}
        options={CONTENT_PRIORITIES.map((p) => [p, CONTENT_PRIORITY_LABEL[p]])}
      />
      <FilterSelect
        label="Due"
        allLabel="Any due date"
        value={query.due}
        onChange={(v) => update({ due: v })}
        options={[
          ["overdue", "Overdue"],
          ["week", "Due in 7 days"],
        ]}
      />
      {people.length > 0 && (
        <FilterSelect
          label="Assignee"
          allLabel="Anyone"
          value={query.assignee}
          onChange={(v) => update({ assignee: v })}
          options={people.map((p) => [p.id, p.name])}
        />
      )}
      <FilterSelect
        label="Library"
        value={query.archived}
        onChange={(v) => update({ archived: v })}
        options={[["1", "Archived"]]}
        allLabel="Current"
      />
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or code"
            aria-label="Search content"
            className="pr-8 pl-8"
          />
          {pending && (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="lg:hidden" onClick={() => setSheet(true)}>
            <SlidersHorizontal data-icon="inline-start" />
            Filters{active > 0 && ` · ${active}`}
          </Button>
          {ideasPending > 0 && (
            <Button
              variant={query.status === "PROPOSED" ? "secondary" : "outline"}
              onClick={() =>
                update({ status: query.status === "PROPOSED" ? undefined : "PROPOSED" })
              }
            >
              <Lightbulb data-icon="inline-start" />
              {ideasPending} idea{ideasPending === 1 ? "" : "s"} to review
            </Button>
          )}
          {active > 0 && (
            <Button
              variant="ghost"
              className="hidden lg:inline-flex"
              onClick={() =>
                update({
                  brand: undefined,
                  type: undefined,
                  status: undefined,
                  origin: undefined,
                  created: undefined,
                  priority: undefined,
                  due: undefined,
                  assignee: undefined,
                  archived: undefined,
                })
              }
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <div className="hidden flex-wrap gap-2 lg:flex">{selects}</div>

      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="pb-safe max-h-[85dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className={cn("grid gap-3 px-4 pb-4 [&_[data-slot=select-trigger]]:w-full")}>
            {selects}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() =>
                  update({
                    brand: undefined,
                    type: undefined,
                    status: undefined,
                    origin: undefined,
                    created: undefined,
                    priority: undefined,
                    due: undefined,
                    assignee: undefined,
                    archived: undefined,
                  })
                }
              >
                Clear all
              </Button>
              <Button className="flex-1" onClick={() => setSheet(false)}>
                Show results
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
  allLabel?: string;
}) {
  return (
    <div className="grid gap-1 lg:block">
      <Label className="text-xs text-muted-foreground lg:sr-only">{label}</Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
        <SelectTrigger className="w-full lg:w-auto lg:min-w-36" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel ?? `All ${label.toLowerCase()}`}</SelectItem>
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
