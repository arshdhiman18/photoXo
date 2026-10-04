import Link from "next/link";
import { ChevronRight, ExternalLink, Send } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { VersionChip } from "@/features/approvals/components/approval-bits";
import { BrandLogo } from "@/features/brands/components/brand-bits";
import { contentTypeLabel } from "@/features/content/components/content-bits";
import { PlatformProgress, UploaderLine } from "@/features/postings/components/posting-bits";
import type { PostingHistoryItemDTO, PostingQueueItemDTO } from "@/features/postings/types";
import { POSTING_PLATFORM_LABEL } from "@/lib/domain/postings";
import { formatDate } from "@/lib/dates";

function age(iso: string, now: number) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

/** Ready-to-post rows (uploader queue or ops overview). */
export function PostingQueueList({
  items,
  hrefBase,
  now,
  showUploader,
  empty,
}: {
  items: PostingQueueItemDTO[];
  hrefBase: string;
  now: number;
  showUploader?: boolean;
  empty: { title: string; description: string };
}) {
  if (items.length === 0) return <EmptyState icon={Send} {...empty} />;
  return (
    <ul className="grid grid-cols-1 gap-2">
      {items.map((i) => (
        <li key={i.id}>
          <Link href={`${hrefBase}/${i.id}`} className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs hover:bg-subtle">
            <BrandLogo name={i.brand.name} logoUrl={i.brand.logoUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2">
                {i.versionNumber && <VersionChip n={i.versionNumber} />}
                <span className="truncate text-[15px] font-medium">{i.title}</span>
              </p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {i.brand.name} · {contentTypeLabel(i.contentType)} · approved {age(i.readySince, now)} ago
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <PlatformProgress states={i.platformStates} />
                {showUploader && <UploaderLine uploader={i.uploader} />}
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {i.progress.posted}/{i.progress.required}
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Confirmed posts, newest first. Internal only (shows who posted / recorded). */
export function PostingHistoryList({
  items,
  hrefBase,
  timeZone,
  showPeople,
}: {
  items: PostingHistoryItemDTO[];
  hrefBase: string;
  timeZone: string;
  showPeople?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyState icon={Send} title="No posts yet" description="Confirmed posts will be listed here." />;
  }
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {items.map((h) => (
        <li key={h.id} className="flex flex-col gap-1 px-4 py-3">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{POSTING_PLATFORM_LABEL[h.platform]}</span>
            <VersionChip n={h.versionNumber} />
            <Link href={`${hrefBase}/${h.content.id}`} className="min-w-0 truncate text-sm hover:underline">
              {h.content.title}
            </Link>
          </p>
          {h.postUrl && (
            <a href={h.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-sm text-tone-info hover:underline">
              <span className="truncate">{h.postUrl}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          )}
          <p className="text-xs text-muted-foreground">
            {h.brand.name}
            {h.postedAt && ` · ${formatDate(h.postedAt, timeZone, { hour: "numeric", minute: "2-digit" })}`}
            {showPeople && h.postedBy && ` · ${h.postedBy.name}`}
            {showPeople && h.source === "RECORDED_BY_ADMIN" && ` · recorded by ${h.recordedBy?.name ?? "admin"}`}
            {h.corrections.length > 0 && ` · corrected ${h.corrections.length}×`}
          </p>
        </li>
      ))}
    </ul>
  );
}
