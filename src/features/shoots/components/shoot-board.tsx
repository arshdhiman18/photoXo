import Link from "next/link";
import { Camera, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { UserAvatar } from "@/components/common/user-avatar";
import { ConflictBadge, ShootStatusBadge } from "@/features/shoots/components/shoot-bits";
import type { ShootListItemDTO } from "@/features/shoots/types";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";
import { formatCalendarDate, formatClock } from "@/lib/dates";
import { cn } from "@/lib/utils";

function CrewLine({ crew }: { crew: ShootListItemDTO["crew"] }) {
  if (crew.length === 0) return <span className="text-sm text-tone-warning">No crew</span>;
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
      {crew.map((c) => (
        <li key={c.id} className="flex min-w-0 items-center gap-1.5 text-sm">
          <UserAvatar name={c.name} image={c.image} seed={c.userId} className="size-5" />
          <span className="truncate">{c.name.split(" ")[0]}</span>
          <span className="text-xs text-muted-foreground">{BRAND_ROLE_LABEL[c.brandRole]}</span>
        </li>
      ))}
    </ul>
  );
}

function StackedTime({ s }: { s: ShootListItemDTO }) {
  return (
    <div className="text-sm tabular-nums">
      <p className="font-semibold whitespace-nowrap">{formatClock(s.startTime)}</p>
      <p className="text-xs whitespace-nowrap text-muted-foreground">to {formatClock(s.endTime)}</p>
    </div>
  );
}

function ShootRow({ s }: { s: ShootListItemDTO }) {
  const cancelled = s.status === "CANCELLED";
  return (
    <li className={cn("relative", cancelled && "opacity-60")}>
      {/* Desktop / tablet: dense row */}
      <div className="hidden grid-cols-[5.5rem_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 hover:bg-subtle lg:grid">
        <StackedTime s={s} />
        <div className="min-w-0">
          <Link href={`/admin/shoots/${s.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">
            {s.brand.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {s.title} · {s.location.name}
          </p>
        </div>
        <CrewLine crew={s.crew} />
        <p className="truncate text-sm text-muted-foreground">{s.contentSummary}</p>
        <div className="flex flex-col items-end gap-1">
          <ShootStatusBadge status={s.status} />
          <ConflictBadge conflicts={s.conflicts} />
        </div>
      </div>
      {/* Phone / tablet: timeline card */}
      <Link href={`/admin/shoots/${s.id}`} className="flex gap-3 px-4 py-3.5 active:bg-subtle lg:hidden">
        <div className="w-[4.5rem] shrink-0">
          <StackedTime s={s} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{s.brand.name}</p>
          <p className="truncate text-sm text-muted-foreground">{s.location.name}</p>
          <p className="mt-1 truncate text-sm">{s.contentSummary}</p>
          <div className="mt-2">
            <CrewLine crew={s.crew} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ShootStatusBadge status={s.status} />
            <ConflictBadge conflicts={s.conflicts} />
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** Shoots grouped by day. Used by the production board, shoot list and brand Shoots tab. */
export function ShootBoard({
  items,
  today,
  emptyTitle = "No shoots",
  emptyDescription,
  emptyAction,
}: {
  items: ShootListItemDTO[];
  today: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return <EmptyState icon={Camera} title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }
  const days = [...new Set(items.map((i) => i.date))];
  return (
    <div className="flex flex-col gap-5">
      {days.map((d) => (
        <section key={d} aria-labelledby={`d-${d}`}>
          <h2 id={`d-${d}`} className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {d === today ? "Today · " : ""}
            {formatCalendarDate(d, { weekday: "long" })}
            <span className="tabular-nums">· {items.filter((i) => i.date === d).length}</span>
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {items
              .filter((i) => i.date === d)
              .map((s) => (
                <ShootRow key={s.id} s={s} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
