/**
 * Accepted upload types (single source of truth). PDFs are stored by
 * Cloudinary as `image` resources (page previews possible); video gets a
 * ~720p MP4 dashboard rendition; images/PDFs are not transcoded needlessly.
 */
export const UPLOAD_TYPES = {
  "image/jpeg": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["jpg", "jpeg"] },
  "image/png": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["png"] },
  "image/webp": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["webp"] },
  "application/pdf": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["pdf"] },
  "video/mp4": { resourceType: "video", maxBytes: 300 * 1024 * 1024, formats: ["mp4"] },
  "video/quicktime": { resourceType: "video", maxBytes: 300 * 1024 * 1024, formats: ["mov"] },
  "video/webm": { resourceType: "video", maxBytes: 300 * 1024 * 1024, formats: ["webm"] },
} as const satisfies Record<string, { resourceType: "image" | "video"; maxBytes: number; formats: readonly string[] }>;
export type UploadMimeType = keyof typeof UPLOAD_TYPES;
export const UPLOAD_MIME_TYPES = Object.keys(UPLOAD_TYPES) as UploadMimeType[];
/** Receipts: images and PDFs only. */
export const RECEIPT_MIME_TYPES: UploadMimeType[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export const UPLOAD_INTENT_TTL_MS = 30 * 60_000;
