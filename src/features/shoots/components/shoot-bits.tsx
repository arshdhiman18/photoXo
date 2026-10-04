import { AlertTriangle, MapPin } from "lucide-react";
import { ToneBadge } from "@/components/common/tone-badge";
import type { ConflictDTO, ShootLocationDTO } from "@/features/shoots/types";
import { formatCalendarDate, formatClock } from "@/lib/dates";
import {
  CREW_STATUS_LABEL,
  SHOOT_STATUS_LABEL,
  SHOOT_STATUS_TONE,
  type CrewStatus,
  type ShootStatus,
} from "@/lib/domain/shoots";
import { cn } from "@/lib/utils";

export function ShootStatusBadge({ status }: { status: ShootStatus }) {
  return <ToneBadge tone={SHOOT_STATUS_TONE[status]}>{SHOOT_STATUS_LABEL[status]}</ToneBadge>;
}

const CREW_TONE: Record<CrewStatus, "neutral" | "info" | "success"> = {
  ASSIGNED: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
};
export function CrewStatusBadge({ status }: { status: CrewStatus }) {
  return <ToneBadge tone={CREW_TONE[status]}>{CREW_STATUS_LABEL[status]}</ToneBadge>;
}

export function TimeRange({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatClock(start)} – {formatClock(end)}
    </span>
  );
}

/** Location with a Maps search link (no geocoding stored). */
export function LocationLink({ location, className }: { location: ShootLocationDTO; className?: string }) {
  const q = encodeURIComponent([location.name, location.address].filter(Boolean).join(", "));
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${q}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex min-w-0 items-center gap-1 hover:underline", className)}
    >
      <MapPin className="size-3.5 shrink-0" />
      <span className="truncate">{location.name}</span>
    </a>
  );
}

export function ConflictBadge({ conflicts }: { conflicts: ConflictDTO[] }) {
  if (conflicts.length === 0) return null;
  const people = [...new Set(conflicts.map((c) => c.userName))];
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-md bg-tone-danger-bg px-1.5 text-xs font-medium text-tone-danger"
      title={conflicts.map((c) => `${c.userName}: ${c.brandName} ${c.startTime}–${c.endTime}`).join("\n")}
    >
      <AlertTriangle className="size-3" />
      {people.length === 1 ? `${people[0]} double-booked` : `${people.length} double-booked`}
    </span>
  );
}

/** Detailed conflict list (forms + detail page). */
export function ConflictList({ conflicts }: { conflicts: ConflictDTO[] }) {
  return (
    <ul className="grid gap-1.5">
      {conflicts.map((c, i) => (
        <li key={`${c.userId}-${c.shootId}-${i}`} className="text-sm">
          <span className="font-medium">{c.userName}</span> is also on{" "}
          <span className="font-medium">{c.shootTitle}</span> ({c.brandName}) ·{" "}
          {formatCalendarDate(c.date)} <TimeRange start={c.startTime} end={c.endTime} /> · {c.locationName}
        </li>
      ))}
    </ul>
  );
}
