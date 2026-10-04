import { ExternalLink, Layers } from "lucide-react";
import type { VersionDTO } from "@/features/content/types";
import { EXTERNAL_ASSET_PROVIDER_LABEL, hashtag } from "@/lib/domain/content";
import { formatDate } from "@/lib/dates";

/** Read-only version history, newest first. Versions are immutable. */
export function VersionsList({ versions, timeZone }: { versions: VersionDTO[]; timeZone: string }) {
  if (versions.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-4 text-sm text-muted-foreground sm:px-5">
        <Layers className="size-4 shrink-0" />
        No versions yet. The creator submits V1 when the first cut is ready.
      </div>
    );
  }
  return (
    <ol className="divide-y">
      {versions.map((v, i) => (
        <li key={v.id} className="px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex h-5 items-center rounded-md bg-primary px-1.5 font-mono text-xs font-medium text-primary-foreground">
              V{v.versionNumber}
            </span>
            {i === 0 && <span className="text-xs font-medium text-muted-foreground">Latest</span>}
            <span className="text-xs text-muted-foreground">
              {v.createdBy?.name ?? "Someone"} ·{" "}
              {formatDate(v.createdAt, timeZone, { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          {v.changeNote && <p className="mt-1.5 text-sm text-pretty">{v.changeNote}</p>}
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {v.assets.map((a) =>
              a.url ? (
                <li key={a.id} className="min-w-0">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border bg-card px-2 text-xs hover:bg-subtle [@media(pointer:coarse)]:h-9"
                  >
                    <span className="font-medium">
                      {a.provider ? EXTERNAL_ASSET_PROVIDER_LABEL[a.provider] : "File"}
                    </span>
                    {a.label && <span className="truncate text-muted-foreground">{a.label}</span>}
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </a>
                </li>
              ) : null,
            )}
          </ul>
          {(v.caption || v.hashtags.length > 0) && (
            <div className="mt-2 rounded-md bg-subtle px-3 py-2 text-sm">
              {v.caption && <p className="text-pretty whitespace-pre-line">{v.caption}</p>}
              {v.hashtags.length > 0 && (
                <p className="mt-1 text-xs text-tone-info">{v.hashtags.map(hashtag).join(" ")}</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
