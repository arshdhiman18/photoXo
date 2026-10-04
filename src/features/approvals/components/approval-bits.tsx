import { ExternalLink } from "lucide-react";
import { ToneBadge } from "@/components/common/tone-badge";
import type { ApprovalRecordDTO } from "@/features/approvals/types";
import type { VersionAssetDTO } from "@/features/content/types";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_STAGE_LABEL,
  type ApprovalDecision,
} from "@/lib/domain/approvals";
import { EXTERNAL_ASSET_PROVIDER_LABEL, hashtag } from "@/lib/domain/content";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function DecisionBadge({ decision }: { decision: ApprovalDecision }) {
  return (
    <ToneBadge tone={decision === "APPROVED" ? "success" : "warning"}>{APPROVAL_DECISION_LABEL[decision]}</ToneBadge>
  );
}

export function VersionChip({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md bg-primary px-1.5 font-mono text-xs font-medium text-primary-foreground",
        className,
      )}
    >
      V{n}
    </span>
  );
}

/** Links to the creation (Canva, Drive, Frame.io…) and to uploaded originals. */
export function AssetLinks({ assets, large }: { assets: Pick<VersionAssetDTO, "id" | "url" | "provider" | "label" | "kind">[]; large?: boolean }) {
  const links = assets.filter((a) => a.url);
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((a) => (
        <li key={a.id} className="min-w-0 max-w-full">
          <a
            href={a.url!}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2.5 text-sm hover:bg-subtle",
              large ? "h-11" : "h-8 [@media(pointer:coarse)]:h-10",
            )}
          >
            <span className="font-medium">{a.provider ? EXTERNAL_ASSET_PROVIDER_LABEL[a.provider] : "Open file"}</span>
            {a.label && <span className="truncate text-muted-foreground">{a.label}</span>}
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Caption + hashtags exactly as they will be approved together with the media. */
export function CaptionBlock({ caption, hashtags }: { caption: string | null; hashtags: string[] }) {
  if (!caption && hashtags.length === 0) return null;
  return (
    <div className="rounded-lg bg-subtle px-3.5 py-3 text-sm">
      {caption && <p className="text-pretty whitespace-pre-line">{caption}</p>}
      {hashtags.length > 0 && (
        <p className="mt-1.5 text-tone-info [overflow-wrap:anywhere]">{hashtags.map(hashtag).join(" ")}</p>
      )}
    </div>
  );
}

const SOURCE_NOTE: Record<ApprovalRecordDTO["source"], string | null> = {
  REVIEWER: null,
  CLIENT_USER: null,
  RECORDED_BY_ADMIN: "recorded for the client",
};

/** Internal approval timeline (newest first). Never rendered for clients. */
export function ApprovalHistoryList({ items, timeZone }: { items: ApprovalRecordDTO[]; timeZone: string }) {
  if (items.length === 0) {
    return <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No review decisions yet.</p>;
  }
  return (
    <ol className="divide-y">
      {items.map((h) => (
        <li key={h.id} className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <VersionChip n={h.version.number} />
            <span className="text-sm font-medium">{APPROVAL_STAGE_LABEL[h.stage]}</span>
            <DecisionBadge decision={h.decision} />
          </div>
          <p className="text-xs text-muted-foreground">
            {h.decidedBy?.name ?? "Someone"}
            {SOURCE_NOTE[h.source] && ` · ${SOURCE_NOTE[h.source]}`} ·{" "}
            {formatDate(h.decidedAt, timeZone, { hour: "numeric", minute: "2-digit" })}
          </p>
          {h.comment && (
            <p className="rounded-md bg-subtle px-3 py-2 text-sm text-pretty whitespace-pre-line">
              {h.comment}
              <span className="mt-1 block text-xs text-muted-foreground">
                {h.commentVisibility === "CLIENT" ? "Client's comment" : "Internal — not shown to the client"}
              </span>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Inline preview of UPLOADED media (signed URLs, authorised viewers only):
 * images inline, video with native controls (720p rendition). Links and
 * PDFs stay as links (AssetLinks).
 */
export function MediaPreviews({ assets }: { assets: Pick<VersionAssetDTO, "id" | "url" | "mediaType" | "format" | "label">[] }) {
  const media = assets.filter((a) => a.url && (a.mediaType === "video" || (a.mediaType === "image" && a.format !== "pdf")));
  if (media.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {media.map((a) =>
        a.mediaType === "video" ? (
          <li key={a.id} className="overflow-hidden rounded-lg border bg-black">
            <video src={a.url!} controls preload="metadata" playsInline className="aspect-video w-full" aria-label={a.label ?? "Video"} />
          </li>
        ) : (
          <li key={a.id} className="overflow-hidden rounded-lg border bg-subtle">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, per-viewer Cloudinary URL; not optimisable by next/image */}
            <img src={a.url!} alt={a.label ?? "Uploaded image"} loading="lazy" className="max-h-96 w-full object-contain" />
          </li>
        ),
      )}
    </ul>
  );
}
