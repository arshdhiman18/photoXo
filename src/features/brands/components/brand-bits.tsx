import { ExternalLink } from "lucide-react";
import { ToneBadge } from "@/components/common/tone-badge";
import type { SocialHandleDTO } from "@/features/brands/types";
import { BRAND_STATUS_LABEL, SOCIAL_PLATFORM_LABEL, type BrandStatus } from "@/lib/domain/brands";
import { cn } from "@/lib/utils";

function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Brand logo with a deterministic monogram fallback (no layout shift). */
export function BrandLogo({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  logoUrl: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = {
    sm: "size-6 text-[10px] rounded-md",
    md: "size-9 text-xs rounded-lg",
    lg: "size-14 text-base rounded-xl",
  }[size];
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-provided URL; next/image would require allow-listing every host
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn("shrink-0 border bg-card object-contain", dims, className)}
      />
    );
  }
  const hue = hueOf(name);
  const letters = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold",
        dims,
        className,
      )}
      style={{ background: `oklch(0.94 0.035 ${hue})`, color: `oklch(0.4 0.09 ${hue})` }}
    >
      {letters || "?"}
    </span>
  );
}

export function BrandStatusBadge({ status }: { status: BrandStatus }) {
  return (
    <ToneBadge tone={status === "ACTIVE" ? "success" : "neutral"}>
      {BRAND_STATUS_LABEL[status]}
    </ToneBadge>
  );
}

export const socialLabel = (h: SocialHandleDTO) =>
  h.platform === "OTHER" && h.label ? h.label : SOCIAL_PLATFORM_LABEL[h.platform];

/** Social handles as compact outbound links. */
export function SocialHandleList({
  handles,
  className,
  limit,
}: {
  handles: SocialHandleDTO[];
  className?: string;
  limit?: number;
}) {
  if (handles.length === 0) return null;
  const shown = limit ? handles.slice(0, limit) : handles;
  const rest = handles.length - shown.length;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {shown.map((h, i) => (
        <li key={`${h.platform}-${i}`} className="min-w-0">
          <a
            href={h.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-6 max-w-[16rem] items-center gap-1 rounded-md border bg-card px-2 text-xs text-muted-foreground transition-colors hover:text-foreground [@media(pointer:coarse)]:h-8"
          >
            <span className="font-medium text-foreground">{socialLabel(h)}</span>
            {h.handle && <span className="truncate">{h.handle}</span>}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </li>
      ))}
      {rest > 0 && (
        <li className="inline-flex h-6 items-center px-1 text-xs text-muted-foreground">+{rest}</li>
      )}
    </ul>
  );
}
