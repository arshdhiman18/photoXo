"use server";

import { z } from "zod";
import { UPLOAD_MIME_TYPES } from "@/lib/domain/media";
import { objectIdString } from "@/lib/validation";
import { authedAction } from "@/server/actions/safe-action";
import { canProposeIdeas } from "@/server/authz/permissions";
import { createUploadIntent, finalizeUpload } from "@/server/services/media.service";

// Strict: the browser never names a Cloudinary public id, owner, brand or URL.
const intentSchema = z
  .object({
    purpose: z.enum(["VERSION_MEDIA", "RECEIPT"]),
    contentId: objectIdString.nullable().default(null),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum(UPLOAD_MIME_TYPES as [string, ...string[]], { error: "This file type isn't supported" }),
    bytes: z.number().int().min(1),
  })
  .strict();

const finalizeSchema = z.object({ intentId: objectIdString }).strict();

// Internal users only (clients never upload); purpose-specific checks in the service.
export const createUploadIntentAction = authedAction(intentSchema, (actor, input) => createUploadIntent(actor, input), {
  authorize: canProposeIdeas,
});

export const finalizeUploadAction = authedAction(finalizeSchema, (actor, input) => finalizeUpload(actor, input.intentId), {
  authorize: canProposeIdeas,
});
