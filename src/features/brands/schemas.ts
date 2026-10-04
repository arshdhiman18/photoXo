import { z } from "zod";
import { BRAND_STATUSES, MAX_SOCIAL_HANDLES, SOCIAL_PLATFORMS } from "@/lib/domain/brands";
import { BrandRole } from "@/lib/domain/roles";
import { objectIdString } from "@/lib/validation";

const BRAND_ROLES = Object.values(BrandRole) as [BrandRole, ...BrandRole[]];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const webUrl = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url({ protocol: /^https?$/, error: "Enter a full link starting with https://" }));

export const socialHandleSchema = z
  .object({
    platform: z.enum(SOCIAL_PLATFORMS, { error: "Choose a platform" }),
    url: webUrl,
    handle: optionalText(100),
    label: optionalText(40),
  })
  .strict();
export type SocialHandleInput = z.input<typeof socialHandleSchema>;

const brandFields = {
  name: z
    .string()
    .trim()
    .min(2, "Brand name must be at least 2 characters")
    .max(80, "Brand name is too long"),
  description: optionalText(1000),
  logoUrl: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(500)
        .pipe(z.url({ protocol: /^https$/, error: "Logo must be an https:// image link" })),
    ])
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  socialHandles: z
    .array(socialHandleSchema)
    .max(MAX_SOCIAL_HANDLES, `At most ${MAX_SOCIAL_HANDLES} social handles`)
    .default([]),
};

export const createBrandSchema = z
  .object({ ...brandFields, status: z.enum(BRAND_STATUSES).default("ACTIVE") })
  .strict();
export type CreateBrandInput = z.input<typeof createBrandSchema>;

/** Status is changed only through archive/reactivate (explicit, audited). */
export const updateBrandSchema = z.object({ brandId: objectIdString, ...brandFields }).strict();
export type UpdateBrandInput = z.input<typeof updateBrandSchema>;

export const brandTargetSchema = z.object({ brandId: objectIdString }).strict();

export const BRAND_PAGE_SIZE = 24;
export const brandListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type BrandListQuery = z.output<typeof brandListQuerySchema>;

// ── Memberships ────────────────────────────────────────────────────────────

export const brandRoleSchema = z.enum(BRAND_ROLES, { error: "Choose a brand role" });

export const addMemberSchema = z
  .object({ brandId: objectIdString, userId: objectIdString, role: brandRoleSchema })
  .strict();

export const membershipTargetSchema = z
  .object({ brandId: objectIdString, membershipId: objectIdString })
  .strict();

export const changeMemberRoleSchema = z
  .object({ brandId: objectIdString, membershipId: objectIdString, role: brandRoleSchema })
  .strict();

export const setPrimaryUploaderSchema = z
  .object({ brandId: objectIdString, userId: objectIdString.nullable() })
  .strict();

export const candidateSearchSchema = z
  .object({
    brandId: objectIdString,
    role: brandRoleSchema,
    q: z.string().trim().max(100).optional().default(""),
  })
  .strict();
