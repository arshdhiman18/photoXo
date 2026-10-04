/**
 * Posting domain — platforms, per-platform posting lifecycle and the content
 * completion rule. Approval is NOT completion: content reaches COMPLETED only
 * once every required platform has an explicit, confirmed POSTED record for
 * the exact client-approved version.
 */
import { ContentStatus } from "./content";

export const PostingPlatform = {
  INSTAGRAM: "INSTAGRAM",
  YOUTUBE: "YOUTUBE",
  TIKTOK: "TIKTOK",
  FACEBOOK: "FACEBOOK",
  PINTEREST: "PINTEREST",
  OTHER: "OTHER",
} as const;
export type PostingPlatform = (typeof PostingPlatform)[keyof typeof PostingPlatform];
export const POSTING_PLATFORMS = Object.values(PostingPlatform);

export const POSTING_PLATFORM_LABEL: Record<PostingPlatform, string> = {
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  FACEBOOK: "Facebook",
  PINTEREST: "Pinterest",
  OTHER: "Other",
};

/**
 * Hosts a post URL may use per platform (exact host or any subdomain).
 * OTHER accepts any https URL. Kept deliberately small — a sanity check,
 * not a link verifier.
 */
export const PLATFORM_HOSTS: Record<PostingPlatform, string[] | null> = {
  INSTAGRAM: ["instagram.com", "instagr.am"],
  YOUTUBE: ["youtube.com", "youtu.be"],
  TIKTOK: ["tiktok.com"],
  FACEBOOK: ["facebook.com", "fb.com", "fb.watch"],
  PINTEREST: ["pinterest.com", "pin.it", "pinterest.co.uk", "pinterest.ca", "pinterest.com.au", "pinterest.in"],
  OTHER: null,
};

/**
 * Validate + normalise a post URL for a platform. Returns the normalised URL
 * (https, lower-case host, no fragment) or an error message.
 */
export function normalizePostUrl(
  platform: PostingPlatform,
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter the full post link, starting with https://" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, error: "Enter the full post link, starting with https://" };
  }
  u.protocol = "https:";
  u.hash = "";
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const allowed = PLATFORM_HOSTS[platform];
  if (allowed && !allowed.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, error: `That doesn't look like a link to ${POSTING_PLATFORM_LABEL[platform]}.` };
  }
  return { ok: true, url: u.toString() };
}

/**
 * Per-platform record state. "Pending" is the ABSENCE of a live record.
 *   POSTING  — the uploader started posting (nothing claimed yet)
 *   POSTED   — explicitly confirmed with a URL and time
 *   CANCELLED — a POSTING record withdrawn because the content went back for
 *               changes before anything was posted (kept for history)
 */
export const PostingStatus = { POSTING: "POSTING", POSTED: "POSTED", CANCELLED: "CANCELLED" } as const;
export type PostingStatus = (typeof PostingStatus)[keyof typeof PostingStatus];
export const POSTING_STATUSES = Object.values(PostingStatus);

/** Who confirmed the post: the uploader, or an ADMIN recording it for them (reason required). */
export const PostingSource = { UPLOADER: "UPLOADER", RECORDED_BY_ADMIN: "RECORDED_BY_ADMIN" } as const;
export type PostingSource = (typeof PostingSource)[keyof typeof PostingSource];
export const POSTING_SOURCES = Object.values(PostingSource);

export type PlatformState = "PENDING" | "POSTING" | "POSTED";

/**
 * The posting state machine on CONTENT. Only the posting service applies it,
 * and only when every required platform is POSTED for the approved version.
 * POSTED and COMPLETED are applied in the same transaction today (no further
 * completion work exists yet), but both states are kept and audited.
 */
export const POSTING_TRANSITIONS = {
  ALL_PLATFORMS_POSTED: { from: [ContentStatus.READY_TO_POST], to: ContentStatus.POSTED },
  COMPLETE: { from: [ContentStatus.POSTED], to: ContentStatus.COMPLETED },
} as const satisfies Record<string, { from: ContentStatus[]; to: ContentStatus }>;

/**
 * Required platforms of a content document. Documents created before Stage 6
 * have no field (lean reads don't apply schema defaults) → none required yet.
 */
export function targetPlatformsOf(c: { targetPlatforms?: PostingPlatform[] | null }): PostingPlatform[] {
  return c.targetPlatforms ?? [];
}

/** Every required platform has a POSTED record → content may become POSTED/COMPLETED. */
export function allRequiredPosted(required: PostingPlatform[], posted: PostingPlatform[]): boolean {
  return required.length > 0 && required.every((p) => posted.includes(p));
}

/** Statuses in which target platforms may still be edited (see posting service for READY_TO_POST). */
export const TARGET_PLATFORMS_EDITABLE: ContentStatus[] = [
  "PROPOSED",
  "PLANNED",
  "IN_PRODUCTION",
  "INTERNAL_REVIEW",
  "CLIENT_REVIEW",
  "CHANGES_REQUESTED",
  "READY_TO_POST",
];

export const MAX_POSTING_NOTE = 1000;
