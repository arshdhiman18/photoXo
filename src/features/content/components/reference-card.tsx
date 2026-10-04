"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferenceDTO } from "@/features/content/types";
import { REFERENCE_PLATFORM_LABEL } from "@/lib/domain/references";
import { cn } from "@/lib/utils";

const SCRIPTS: Record<string, string> = {
  INSTAGRAM: "https://www.instagram.com/embed.js",
  TIKTOK: "https://www.tiktok.com/embed.js",
};

function loadScriptOnce(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  document.body.appendChild(s);
}

/**
 * Third-party embed, loaded only when the user asks (privacy + data on
 * mobile). Never assumes an embed works: the original link is always shown,
 * and unsupported/unparsed URLs render as a link card.
 */
function Embed({ reference }: { reference: ReferenceDTO }) {
  const host = useRef<HTMLDivElement>(null);
  const { platform, externalId, url, variant } = reference;

  useEffect(() => {
    if (platform === "INSTAGRAM") {
      loadScriptOnce(SCRIPTS.INSTAGRAM!);
      (
        window as unknown as { instgrm?: { Embeds: { process(): void } } }
      ).instgrm?.Embeds.process();
    }
    if (platform === "TIKTOK") loadScriptOnce(SCRIPTS.TIKTOK!);
  }, [platform]);

  if (platform === "YOUTUBE" && externalId) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(externalId)}`}
          title={reference.title ?? "YouTube reference"}
          className="size-full"
          loading="lazy"
          allow="encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  if (platform === "INSTAGRAM" && externalId) {
    return (
      <div ref={host} className="max-w-[400px] overflow-hidden">
        <blockquote
          className="instagram-media"
          data-instgrm-permalink={`https://www.instagram.com/${variant ?? "p"}/${externalId}/`}
          data-instgrm-version="14"
          style={{ margin: 0, minWidth: 0, width: "100%" }}
        />
      </div>
    );
  }
  if (platform === "TIKTOK" && externalId && url) {
    return (
      <blockquote
        className="tiktok-embed"
        cite={url}
        data-video-id={externalId}
        style={{ margin: 0, maxWidth: 325 }}
      >
        <section />
      </blockquote>
    );
  }
  return null;
}

const EMBEDDABLE = (r: ReferenceDTO) =>
  Boolean(r.externalId) && ["YOUTUBE", "INSTAGRAM", "TIKTOK"].includes(r.platform);

export function ReferenceCard({
  reference,
  className,
}: {
  reference: ReferenceDTO;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const label = REFERENCE_PLATFORM_LABEL[reference.platform];
  let host = "";
  try {
    host = reference.url ? new URL(reference.url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }

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
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {EMBEDDABLE(reference) && (
          <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)} aria-expanded={show}>
            <Play data-icon="inline-start" />
            {show ? "Hide preview" : "Preview"}
          </Button>
        )}
        {reference.url && (
          <Button asChild variant="ghost" size="sm">
            <a href={reference.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink data-icon="inline-start" />
              Open original
            </a>
          </Button>
        )}
      </div>
      {show && (
        <div className="border-t p-3">
          <Embed reference={reference} />
          <p className="mt-2 text-xs text-muted-foreground">
            If the preview doesn&apos;t load (private post, region or platform limits), use “Open
            original”.
          </p>
        </div>
      )}
    </div>
  );
}
