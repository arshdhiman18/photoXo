import "server-only";
import type { BrandDetailDTO, BrandPublicDTO, SocialHandleDTO } from "@/features/brands/types";
import type { BrandDoc, SocialHandle } from "@/server/db/models";

export const toSocialHandleDTO = (h: SocialHandle): SocialHandleDTO => ({
  platform: h.platform,
  url: h.url,
  handle: h.handle ?? null,
  label: h.label ?? null,
});

export function toBrandDetailDTO(b: BrandDoc): BrandDetailDTO {
  return {
    id: String(b._id),
    name: b.name,
    slug: b.slug,
    description: b.description ?? null,
    logoUrl: b.logo?.url ?? null,
    status: b.status,
    socialHandles: b.socialHandles.map(toSocialHandleDTO),
    primaryUploaderId: b.primaryUploaderId ? String(b.primaryUploaderId) : null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** Staff/client projection — no status internals, uploader routing, or audit fields. */
export function toBrandPublicDTO(b: BrandDoc): BrandPublicDTO {
  return {
    id: String(b._id),
    name: b.name,
    logoUrl: b.logo?.url ?? null,
    description: b.description ?? null,
    socialHandles: b.socialHandles.map(toSocialHandleDTO),
  };
}
