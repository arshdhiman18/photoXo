import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Cloudinary client (Stage 1 foundation + Stage 8 media workflow). Signed
 * REST calls, no SDK. Media is stored as `type: "authenticated"`, so files
 * are only reachable through URLs this server signs for an authorised
 * viewer. The browser uploads the original directly to Cloudinary with
 * parameters signed here (the server decides the public id); the server
 * then verifies the stored resource via the Admin API before recording it.
 * Processing (720p video rendition, image previews) happens on Cloudinary,
 * never in the browser.
 *
 * Not production-verified in this repository (no credentials in CI): the
 * request formats follow Cloudinary's documented signed-upload, Admin API and
 * signed-delivery-URL schemes and are unit-tested for shape.
 */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function getCloudinaryConfig(): CloudinaryConfig | null {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return null;
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  };
}

export const isCloudinaryConfigured = () => getCloudinaryConfig() !== null;

function requireConfig(): CloudinaryConfig {
  const c = getCloudinaryConfig();
  if (!c) throw new Error("Cloudinary is not configured");
  return c;
}

/**
 * Cloudinary request signature: SHA-1 of the alphabetically sorted
 * `key=value` pairs joined by `&`, with the API secret appended.
 * (file, cloud_name, resource_type and api_key are excluded by contract.)
 */
export function signCloudinaryParams(
  params: Record<string, string | number | boolean | undefined>,
  apiSecret: string,
): string {
  const toSign = Object.entries(params)
    .filter(([k, v]) => v !== undefined && v !== "" && !["file", "cloud_name", "resource_type", "api_key"].includes(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

export type ResourceType = "image" | "video" | "raw";

/** Parameters the browser must send with the file — every value chosen by the server. */
export function signedUploadParams(opts: { publicId: string; resourceType: ResourceType; now?: Date }) {
  const { cloudName, apiKey, apiSecret } = requireConfig();
  const params = {
    public_id: opts.publicId,
    timestamp: Math.floor((opts.now ?? new Date()).getTime() / 1000),
    type: "authenticated",
    overwrite: "false",
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${opts.resourceType}/upload`,
    fields: { ...params, api_key: apiKey, signature: signCloudinaryParams(params, apiSecret) } as Record<string, string | number>,
  };
}

export interface CloudinaryResource {
  public_id: string;
  resource_type: ResourceType;
  type: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  version: number;
}

/** What is actually stored under OUR public id (Admin API). null when absent. */
export async function fetchResource(publicId: string, resourceType: ResourceType): Promise<CloudinaryResource | null> {
  const { cloudName, apiKey, apiSecret } = requireConfig();
  const path = publicId.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/authenticated/${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloudinary lookup failed (${res.status})`);
  return (await res.json()) as CloudinaryResource;
}

/**
 * Signed delivery URL for an authenticated asset:
 *   https://res.cloudinary.com/<cloud>/<type>/authenticated/s--<sig>--/<transformation>/<public_id>.<ext>
 * <sig> = first 8 chars of URL-safe base64 SHA-1("<transformation>/<public_id>.<ext>" + secret).
 */
export function signedDeliveryUrl(opts: { publicId: string; resourceType: ResourceType; format: string; transformation?: string }): string {
  const { cloudName, apiSecret } = requireConfig();
  const toSign = [opts.transformation, `${opts.publicId}.${opts.format}`].filter(Boolean).join("/");
  const sig = createHash("sha1").update(toSign + apiSecret).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").slice(0, 8);
  return `https://res.cloudinary.com/${cloudName}/${opts.resourceType}/authenticated/s--${sig}--/${toSign}`;
}

/** Dashboard renditions: ~720p MP4 for video, size-limited image; raw/PDF untouched (no needless transcoding). */
export function renditionFor(resourceType: ResourceType): { transformation?: string; format?: string } {
  if (resourceType === "video") return { transformation: "c_limit,h_720,q_auto,vc_auto", format: "mp4" };
  if (resourceType === "image") return { transformation: "c_limit,w_1600,q_auto" };
  return {};
}
