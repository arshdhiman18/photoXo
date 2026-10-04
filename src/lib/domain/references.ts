import { safeHost } from "./content";

export const ReferencePlatform = {
  INSTAGRAM: "INSTAGRAM",
  YOUTUBE: "YOUTUBE",
  TIKTOK: "TIKTOK",
  PINTEREST: "PINTEREST",
  WEBSITE: "WEBSITE",
  FILE: "FILE",
} as const;
export type ReferencePlatform = (typeof ReferencePlatform)[keyof typeof ReferencePlatform];
export const REFERENCE_PLATFORMS = Object.values(ReferencePlatform);
export const REFERENCE_PLATFORM_LABEL: Record<ReferencePlatform, string> = {
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  PINTEREST: "Pinterest",
  WEBSITE: "Website",
  FILE: "Uploaded file",
};

export interface ParsedReferenceUrl {
  platform: Exclude<ReferencePlatform, "FILE">;
  url: string;
  externalId: string | null;
  /** Instagram post kind (p | reel | tv) — affects the embed URL. */
  variant: string | null;
  /** Deterministic thumbnail where the platform exposes one without an API call. */
  thumbnailUrl: string | null;
}

/**
 * Classify a reference URL and extract the platform id. Pure — no network.
 * Anything unrecognised is a WEBSITE reference (shown as a link card).
 */
export function parseReferenceUrl(raw: string): ParsedReferenceUrl {
  const url = raw.trim();
  const host = safeHost(url) ?? "";
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    /* handled below */
  }
  const path = parsed?.pathname ?? "";
  const base = { url, externalId: null, variant: null, thumbnailUrl: null };

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = path.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    return {
      ...base,
      platform: "INSTAGRAM",
      externalId: m?.[2] ?? null,
      variant: m ? (m[1] === "reels" ? "reel" : m[1]!) : null,
    };
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com"
  ) {
    let id: string | null = null;
    if (host === "youtu.be") id = path.slice(1).split("/")[0] || null;
    else if (path === "/watch") id = parsed?.searchParams.get("v") ?? null;
    else id = path.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1] ?? null;
    if (id && !/^[\w-]{6,20}$/.test(id)) id = null;
    return {
      ...base,
      platform: "YOUTUBE",
      externalId: id,
      thumbnailUrl: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
    };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return { ...base, platform: "TIKTOK", externalId: path.match(/\/video\/(\d+)/)?.[1] ?? null };
  }
  if (host === "pin.it" || /(^|\.)pinterest\.[a-z.]+$/.test(host)) {
    return { ...base, platform: "PINTEREST", externalId: path.match(/\/pin\/(\d+)/)?.[1] ?? null };
  }
  return { ...base, platform: "WEBSITE" };
}
