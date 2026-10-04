import { ArrowUp, ChevronsUp } from "lucide-react";
import { ToneBadge } from "@/components/common/tone-badge";
import {
  CONTENT_ORIGIN_LABEL,
  CONTENT_STATUS_LABEL,
  CONTENT_STATUS_TONE,
  CONTENT_TYPES,
  TASK_STATUS_LABEL,
  type ContentOrigin,
  type ContentPriority,
  type ContentStatus,
  type ContentType,
  type TaskStatus,
} from "@/lib/domain/content";
import { cn } from "@/lib/utils";

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return <ToneBadge tone={CONTENT_STATUS_TONE[status]}>{CONTENT_STATUS_LABEL[status]}</ToneBadge>;
}

const TASK_TONE: Record<TaskStatus, "neutral" | "info" | "success" | "warning"> = {
  TODO: "neutral",
  IN_PROGRESS: "info",
  BLOCKED: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <ToneBadge tone={TASK_TONE[status]}>{TASK_STATUS_LABEL[status]}</ToneBadge>;
}

export function ContentCode({ code, className }: { code: string; className?: string }) {
  return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{code}</span>;
}

export const contentTypeLabel = (t: ContentType) => CONTENT_TYPES[t].label;
export const originLabel = (o: ContentOrigin) => CONTENT_ORIGIN_LABEL[o];

/** Priority is only shown when it deviates from normal (signal, not noise). */
export function PriorityMark({
  priority,
  withLabel = false,
}: {
  priority: ContentPriority;
  withLabel?: boolean;
}) {
  if (priority === "NORMAL" || priority === "LOW") {
    return withLabel ? (
      <span className="text-sm text-muted-foreground">{priority === "LOW" ? "Low" : "Normal"}</span>
    ) : null;
  }
  const urgent = priority === "URGENT";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        urgent ? "text-tone-danger" : "text-tone-warning",
      )}
      title={urgent ? "Urgent" : "High priority"}
    >
      {urgent ? <ChevronsUp className="size-3.5" /> : <ArrowUp className="size-3.5" />}
      {withLabel || urgent ? (
        urgent ? (
          "Urgent"
        ) : (
          "High"
        )
      ) : (
        <span className="sr-only">High priority</span>
      )}
    </span>
  );
}

/**
 * Due date in the agency time zone. `today` (YYYY-MM-DD in the same zone,
 * computed once per request by the page) marks overdue dates.
 */
export function DueDate({
  iso,
  timeZone,
  today,
  className,
}: {
  iso: string | null;
  timeZone: string;
  today?: string;
  className?: string;
}) {
  if (!iso) return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  const d = new Date(iso);
  const overdue = Boolean(today) && iso.slice(0, 10) < today!;
  return (
    <time
      dateTime={iso}
      className={cn(
        "text-sm tabular-nums",
        overdue ? "text-tone-danger" : "text-foreground",
        className,
      )}
      title={overdue ? "Overdue" : undefined}
    >
      {new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short" }).format(d)}
    </time>
  );
}

/** Done/total progress for task indicators. */
export function TaskProgress({
  done,
  total,
  unassigned,
}: {
  done: number;
  total: number;
  unassigned: number;
}) {
  if (total === 0) return <span className="text-sm text-muted-foreground">No tasks</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full rounded-full bg-tone-success" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
      {unassigned > 0 && (
        <span className="text-xs text-tone-warning" title={`${unassigned} unassigned`}>
          {unassigned} unassigned
        </span>
      )}
    </span>
  );
}
