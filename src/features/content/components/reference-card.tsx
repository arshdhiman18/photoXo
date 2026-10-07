import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferenceDTO } from "@/features/content/types";
import { REFERENCE_PLATFORM_LABEL } from "@/lib/domain/references";
import { cn } from "@/lib/utils";

/** Social platforms whose links open in their own app on phones. */
const APP_PLATFORMS = new Set(["INSTAGRAM", "YOUTUBE", "TIKTOK", "PINTEREST"]);

/**
 * A reference link card. No in-page embeds: the button opens the original
 * post (on phones, Instagram / YouTube / TikTok links open in their app).
 */
export function ReferenceCard({
  reference,
  className,
}: {
  reference: ReferenceDTO;
  className?: string;
}) {
  const label = REFERENCE_PLATFORM_LABEL[reference.platform];
  let host = "";
  try {
    host = reference.url ? new URL(reference.url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const openLabel = APP_PLATFORMS.has(reference.platform) ? `Open in ${label}` : "Open link";

  return (
    <div className={cn("min-w-0 rounded-lg border bg-card", className)}>
      <div className="flex items-start gap-3 p-3">
        {reference.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- platform thumbnail URL (no proxying/downloading)
          <img
            src={reference.thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-12 w-20 shrink-0 rounded-md border object-cover"
          />
        ) : (
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-subtle text-[10px] font-medium text-muted-foreground uppercase">
            {label.slice(0, 2)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{reference.title ?? `${label} reference`}</p>
          <p className="truncate text-xs text-muted-foreground">
            {label}
            {host && ` · ${host}`}
          </p>
          {reference.notes && (
            <p className="mt-1 text-xs text-pretty text-muted-foreground">{reference.notes}</p>
          )}
        </div>
      </div>
      {reference.url && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <Button asChild variant="ghost" size="sm">
            <a href={reference.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink data-icon="inline-start" />
              {openLabel}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
