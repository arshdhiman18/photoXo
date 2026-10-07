/**
 * Accepted upload types (single source of truth). Everything is compressed
 * before it is stored: images in the browser (see lib/image-compress) and
 * again by Cloudinary on arrival; videos are re-encoded on arrival to ≤1080p
 * H.264 MP4 (so MOV/WebM are stored as MP4). PDFs are stored as-is.
 * Video limit = Cloudinary's free-plan maximum per upload (100 MB).
 */
export const UPLOAD_TYPES = {
  "image/jpeg": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["jpg", "jpeg"] },
  "image/png": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["png"] },
  "image/webp": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["webp"] },
  "application/pdf": { resourceType: "image", maxBytes: 25 * 1024 * 1024, formats: ["pdf"] },
  "video/mp4": { resourceType: "video", maxBytes: 100 * 1024 * 1024, formats: ["mp4"] },
  "video/quicktime": { resourceType: "video", maxBytes: 100 * 1024 * 1024, formats: ["mov", "mp4"] },
  "video/webm": { resourceType: "video", maxBytes: 100 * 1024 * 1024, formats: ["webm", "mp4"] },
} as const satisfies Record<string, { resourceType: "image" | "video"; maxBytes: number; formats: readonly string[] }>;
export type UploadMimeType = keyof typeof UPLOAD_TYPES;
export const UPLOAD_MIME_TYPES = Object.keys(UPLOAD_TYPES) as UploadMimeType[];
/** Receipts: images and PDFs only. */
export const RECEIPT_MIME_TYPES: UploadMimeType[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
/** Brand logos: images only, small. */
export const LOGO_MIME_TYPES: UploadMimeType[] = ["image/jpeg", "image/png", "image/webp"];
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Compression Cloudinary applies on arrival ("incoming transformation"): the
 * stored file IS the compressed one. Images ≤2560px at good automatic
 * quality; logos ≤512px; videos ≤1080p H.264/AAC MP4 at good automatic quality.
 */
export function incomingTransformation(purpose: "VERSION_MEDIA" | "RECEIPT" | "BRAND_LOGO", mimeType: string): { transformation?: string; format?: string } {
  if (mimeType === "application/pdf") return {};
  if (mimeType.startsWith("video/")) return { transformation: "c_limit,w_1920,h_1920,q_auto:good,vc_h264,ac_aac", format: "mp4" };
  if (purpose === "BRAND_LOGO") return { transformation: "c_limit,w_512,h_512,q_auto:good" };
  return { transformation: "c_limit,w_2560,h_2560,q_auto:good" };
}

export const UPLOAD_INTENT_TTL_MS = 30 * 60_000;
