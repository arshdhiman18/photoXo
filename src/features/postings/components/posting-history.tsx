import { ExternalLink } from "lucide-react";
import { VersionChip } from "@/features/approvals/components/approval-bits";
import type { PostingRecordDTO } from "@/features/postings/types";
import { POSTING_PLATFORM_LABEL } from "@/lib/domain/postings";
import { formatDate } from "@/lib/dates";

const STATUS: Record<PostingRecordDTO["status"], string> = { POSTING: "Started", POSTED: "Posted", CANCELLED: "Cancelled" };

/**
 * Every posting record, grouped by the exact version it belongs to (never
 * collapsed across versions). The version in the current posting round is
 * marked "Current"; earlier ones are history and are never rewritten.
 */
export function PostingHistoryByVersion({
  records,
  currentVersionNumber,
  timeZone,
}: {
  records: PostingRecordDTO[];
  currentVersionNumber: number | null;
  timeZone: string;
}) {
  const versions = [...new Set(records.map((r) => r.versionNumber))].sort((a, b) => b - a);
  const when = (iso: string) => formatDate(iso, timeZone, { hour: "numeric", minute: "2-digit" });
  return (
    <ol className="divide-y">
      {versions.map((n) => (
        <li key={n} className="px-4 py-3 sm:px-5">
          <p className="mb-2 flex items-center gap-2 text-sm">
            <VersionChip n={n} />
            <span className="font-medium">{n === currentVersionNumber ? "Current posting round" : "Historical"}</span>
          </p>
          <ul className="grid gap-1.5">
            {records
              .filter((r) => r.versionNumber === n)
              .map((r) => (
                <li key={r.id} className="grid gap-0.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                  <span className="font-medium">
                    {POSTING_PLATFORM_LABEL[r.platform]} <span className="font-normal text-muted-foreground">· {STATUS[r.status]}</span>
                  </span>
                  <span className="min-w-0">
                    {r.postUrl ? (
                      <a href={r.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-tone-info hover:underline">
                        <span className="truncate">{r.postUrl}</span>
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">No link</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {r.postedAt ? `Posted ${when(r.postedAt)}` : `Started ${when(r.startedAt)}`}
                      {r.postedBy && ` · ${r.postedBy.name}`}
                      {r.source === "RECORDED_BY_ADMIN" && ` · recorded by ${r.recordedBy?.name ?? "admin"}`}
                      {r.corrections.length > 0 && ` · corrected ${r.corrections.length}×`}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
