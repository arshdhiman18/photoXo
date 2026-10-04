import Link from "next/link";
import { BadgeCheck, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { DecisionBadge, VersionChip } from "@/features/approvals/components/approval-bits";
import type { RecentDecisionDTO, ReviewQueueItemDTO } from "@/features/approvals/types";
import { ContentCode, contentTypeLabel } from "@/features/content/components/content-bits";
import { APPROVAL_STAGE_LABEL } from "@/lib/domain/approvals";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type QueueTab = "internal" | "client" | "changes" | "decisions";

export function QueueTabs({
  base,
  tab,
  counts,
}: {
  base: string;
  tab: QueueTab;
  counts: Record<Exclude<QueueTab, "decisions">, number>;
}) {
  const tabs: [QueueTab, string][] = [
    ["internal", `Internal review · ${counts.internal}`],
    ["client", `With client · ${counts.client}`],
    ["changes", `Changes requested · ${counts.changes}`],
    ["decisions", "Recent decisions"],
  ];
  return (
    <nav aria-label="Approval queues" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={key === "internal" ? base : `${base}?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground [@media(pointer:coarse)]:h-9",
              tab === key && "bg-card font-medium text-foreground shadow-sm",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

const EMPTY: Record<Exclude<QueueTab, "decisions">, { title: string; description: string }> = {
  internal: { title: "Nothing to review", description: "Versions submitted for internal review appear here, oldest first." },
  client: { title: "Nothing with clients", description: "Internally approved content waiting on the client appears here." },
  changes: { title: "No open change requests", description: "Content sent back for changes appears here until a new version is submitted." },
};

/** "today", "1 day", "4 days" since `iso`. */
function age(iso: string, now: number) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

/** Queue rows, oldest waiting first. Detail and actions live on the content page. */
export function ReviewQueueList({
  items,
  tab,
  now,
}: {
  items: ReviewQueueItemDTO[];
  tab: Exclude<QueueTab, "decisions">;
  /** Request time (ms), passed from the server page. */
  now: number;
}) {
  if (items.length === 0) return <EmptyState icon={BadgeCheck} {...EMPTY[tab]} />;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {items.map((i) => (
        <li key={i.id}>
          <Link href={`/admin/content/${i.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-subtle sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2">
                {i.versionNumber && tab !== "changes" && <VersionChip n={i.versionNumber} />}
                {i.changeRequest && <VersionChip n={i.changeRequest.versionNumber} />}
                <span className="truncate text-sm font-medium">{i.title}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {i.brand.name} · <ContentCode code={i.code} /> · {contentTypeLabel(i.contentType)}
              </p>
              {i.changeRequest && (
                <p className="mt-1.5 line-clamp-2 text-sm text-pretty">
                  <span className="font-medium">
                    {i.changeRequest.stage === "CLIENT" ? "Client" : "Internal"}:
                  </span>{" "}
                  {i.changeRequest.comment}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {tab === "changes" ? "Sent back" : "Waiting"} {age(i.waitingSince, now)}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RecentDecisionsList({ items, timeZone }: { items: RecentDecisionDTO[]; timeZone: string }) {
  if (items.length === 0) {
    return <EmptyState icon={BadgeCheck} title="No decisions yet" description="Approvals and change requests will be listed here." />;
  }
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {items.map((d) => (
        <li key={d.id}>
          <Link href={`/admin/content/${d.content.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-subtle">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <VersionChip n={d.version.number} />
              <span className="min-w-0 truncate text-sm font-medium">{d.content.title}</span>
              <DecisionBadge decision={d.decision} />
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {APPROVAL_STAGE_LABEL[d.stage]} · {d.brand.name} · {d.decidedBy?.name ?? "Someone"}
              {d.source === "RECORDED_BY_ADMIN" && " (recorded for the client)"} ·{" "}
              {formatDate(d.decidedAt, timeZone, { hour: "numeric", minute: "2-digit" })}
            </p>
            {d.comment && <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">{d.comment}</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
