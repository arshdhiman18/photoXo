import "server-only";
import type { AssetDoc } from "@/server/db/models";
import { isCloudinaryConfigured, renditionFor, signedDeliveryUrl } from "./cloudinary";

/**
 * The URL an AUTHORISED viewer may open for an asset. Callers must have
 * checked access first (content/expense scope). External links are returned
 * as-is (they were entered by the team); uploaded media gets a signed
 * Cloudinary URL — never a public or client-supplied one.
 */
export function assetViewUrl(a: Pick<AssetDoc, "storage" | "external" | "media">): string | null {
  if (a.storage === "EXTERNAL_LINK") return a.external?.url ?? null;
  const m = a.media;
  if (!m || m.purgedAt || !isCloudinaryConfigured()) return null;
  const r = renditionFor(m.resourceType);
  return signedDeliveryUrl({ publicId: m.publicId, resourceType: m.resourceType, format: r.format ?? m.format, transformation: r.transformation });
}

/** Signed URL of the untouched original (download). */
export function assetOriginalUrl(a: Pick<AssetDoc, "storage" | "external" | "media">): string | null {
  if (a.storage === "EXTERNAL_LINK") return a.external?.url ?? null;
  const m = a.media;
  if (!m || m.purgedAt || !isCloudinaryConfigured()) return null;
  return signedDeliveryUrl({ publicId: m.publicId, resourceType: m.resourceType, format: m.format });
}
