import { AlertTriangle } from "lucide-react";
import { ToneBadge } from "@/components/common/tone-badge";
import type { UploaderStateDTO } from "@/features/postings/types";
import { POSTING_PLATFORM_LABEL, type PlatformState, type PostingPlatform } from "@/lib/domain/postings";
import { cn } from "@/lib/utils";

const STATE: Record<PlatformState, { label: string; tone: "neutral" | "info" | "success" }> = {
  PENDING: { label: "Pending", tone: "neutral" },
  POSTING: { label: "Posting", tone: "info" },
  POSTED: { label: "Posted", tone: "success" },
};

export function PlatformStateBadge({ state }: { state: PlatformState }) {
  return <ToneBadge tone={STATE[state].tone}>{STATE[state].label}</ToneBadge>;
}

/** "Instagram ✓ · YouTube" — compact per-platform progress for queue rows. */
export function PlatformProgress({ states }: { states: { platform: PostingPlatform; state: PlatformState }[] }) {
  if (states.length === 0) return <span className="text-xs text-tone-warning">No platforms set</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {states.map((s) => (
        <li
          key={s.platform}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs",
            s.state === "POSTED" && "border-tone-success/30 bg-tone-success-bg text-tone-success",
            s.state === "POSTING" && "border-tone-info/30 bg-tone-info-bg text-tone-info",
            s.state === "PENDING" && "text-muted-foreground",
          )}
        >
          {POSTING_PLATFORM_LABEL[s.platform]}
          {s.state === "POSTED" && " ✓"}
        </li>
      ))}
    </ul>
  );
}

const PROBLEM: Record<NonNullable<UploaderStateDTO["problem"]>, string> = {
  NO_UPLOADER: "No uploader assigned",
  INACTIVE_ACCOUNT: "Uploader's account is inactive",
  NOT_AN_UPLOADER: "No longer an uploader on this brand",
};

/** Who posts this — and a clear warning when the assignment needs fixing. */
export function UploaderLine({ uploader, className }: { uploader: UploaderStateDTO; className?: string }) {
  if (!uploader.valid) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-sm font-medium text-tone-danger", className)}>
        <AlertTriangle className="size-3.5 shrink-0" />
        {PROBLEM[uploader.problem ?? "NO_UPLOADER"]}
        {uploader.person && ` (${uploader.person.name})`}
      </span>
    );
  }
  return (
    <span className={cn("text-sm text-muted-foreground", className)}>
      {uploader.person?.name ?? "Uploader"}
      {uploader.source === "OVERRIDE" ? " · set for this content" : " · brand uploader"}
    </span>
  );
}
