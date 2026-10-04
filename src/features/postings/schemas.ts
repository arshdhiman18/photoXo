import { z } from "zod";
import { MAX_POSTING_NOTE, POSTING_PLATFORMS } from "@/lib/domain/postings";
import { objectIdString } from "@/lib/validation";

// Strict: uploaderId, postedBy, recordedBy, agencyId, brandId, status and the
// approved version are never accepted as state. `versionId` is only the
// version the viewer is looking at; the server requires it to equal the
// content's clientApprovedVersionId.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const link = z.string().trim().min(1, "Paste the post link").max(1000);
const optionalLink = z
  .union([z.literal(""), z.string().trim().max(1000).pipe(z.url({ protocol: /^https?$/, error: "Enter a full link starting with https://" }))])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
/** ISO date-time from the browser (datetime-local converted client-side); defaults to now. */
const postedAt = z
  .union([z.literal(""), z.iso.datetime({ offset: true, error: "Enter when it was posted" })])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const reason = z.string().trim().min(3, "Add a short reason").max(500);

const target = {
  contentId: objectIdString,
  versionId: objectIdString,
  platform: z.enum(POSTING_PLATFORMS),
};

export const startPostingSchema = z.object(target).strict();

export const confirmPostedSchema = z
  .object({
    ...target,
    postUrl: link,
    postedAt,
    screenshotUrl: optionalLink,
    note: optionalText(MAX_POSTING_NOTE),
  })
  .strict();

export const recordPostingOnBehalfSchema = z
  .object({
    ...target,
    postUrl: link,
    postedAt,
    screenshotUrl: optionalLink,
    note: optionalText(MAX_POSTING_NOTE),
    reason,
  })
  .strict();

export const correctPostingSchema = z
  .object({
    postingId: objectIdString,
    postUrl: link,
    postedAt,
    screenshotUrl: optionalLink,
    reason,
  })
  .strict();

export const targetPlatformsSchema = z
  .object({
    contentId: objectIdString,
    platforms: z
      .array(z.enum(POSTING_PLATFORMS))
      .max(POSTING_PLATFORMS.length)
      .transform((v) => [...new Set(v)]),
  })
  .strict();

/** Post-publication revision: content id + mandatory reason only (no version/state from the browser). */
export const startRevisionSchema = z
  .object({ contentId: objectIdString, reason: z.string().trim().min(3, "Say why a new version is needed").max(1000) })
  .strict();

export const reopenForChangesSchema = z
  .object({ contentId: objectIdString, versionId: objectIdString, reason })
  .strict();
