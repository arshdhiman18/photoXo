import { z } from "zod";
import { MAX_SHOOT_CONTENT, MAX_SHOOT_CREW, SHOOT_CREW_ROLES, SHOOT_STATUSES, TIME_RE } from "@/lib/domain/shoots";
import { objectIdString } from "@/lib/validation";

// Strict: agency, creator, assigner and actor ids are never accepted.

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const date = z.iso.date("Enter a valid date");
const time = z.string().regex(TIME_RE, "Use HH:mm");
const reason = z.string().trim().min(3, "Add a short reason").max(500);
/** Present only when an authorised manager deliberately overrides crew conflicts. */
const overrideReason = z.string().trim().min(3, "Explain why the overlap is OK").max(500).optional();

const slotFields = {
  date,
  startTime: time,
  endTime: time,
  locationName: z.string().trim().min(2, "Add a location").max(160),
  locationAddress: text(300),
};
const endAfterStart = (d: { startTime: string; endTime: string }) => d.endTime > d.startTime;
const endMsg = { path: ["endTime"], message: "End time must be after start time" };

export const crewInputSchema = z
  .object({
    userId: objectIdString,
    brandRole: z.enum(SHOOT_CREW_ROLES as [string, ...string[]]),
    required: z.boolean().default(true),
  })
  .strict();

export const createShootSchema = z
  .object({
    brandId: objectIdString,
    title: z.string().trim().min(3, "Title must be at least 3 characters").max(160),
    ...slotFields,
    notes: text(2000),
    contentIds: z.array(objectIdString).max(MAX_SHOOT_CONTENT).default([]),
    crew: z.array(crewInputSchema).max(MAX_SHOOT_CREW).default([]),
    overrideReason,
  })
  .strict()
  .refine(endAfterStart, endMsg);
export type CreateShootInput = z.input<typeof createShootSchema>;

export const updateShootDetailsSchema = z
  .object({
    shootId: objectIdString,
    title: z.string().trim().min(3).max(160),
    notes: text(2000),
  })
  .strict();

export const rescheduleShootSchema = z
  .object({ shootId: objectIdString, ...slotFields, reason: text(500), overrideReason })
  .strict()
  .refine(endAfterStart, endMsg);

export const shootContentChangeSchema = z
  .object({ shootId: objectIdString, contentId: objectIdString })
  .strict();

export const addCrewSchema = z
  .object({
    shootId: objectIdString,
    userId: objectIdString,
    brandRole: z.enum(SHOOT_CREW_ROLES as [string, ...string[]]),
    required: z.boolean().default(true),
    overrideReason,
  })
  .strict();

export const crewTargetSchema = z.object({ shootId: objectIdString, crewId: objectIdString }).strict();

export const completeOnBehalfSchema = z
  .object({ shootId: objectIdString, crewId: objectIdString, reason })
  .strict();

/** Self-service: identifies only the shoot; the crew member is the session user. */
export const shootTargetSchema = z.object({ shootId: objectIdString }).strict();

export const cancelShootSchema = z.object({ shootId: objectIdString, reason }).strict();

export const shootOptionsSchema = z
  .object({ brandId: objectIdString, shootId: objectIdString.optional() })
  .strict();

// ── Board query (URL params; invalid values dropped) ───────────────────────

export const boardQuerySchema = z.object({
  date: z.iso.date().optional().catch(undefined),
  view: z.enum(["day", "week"]).optional().catch(undefined),
  brand: objectIdString.optional().catch(undefined),
  status: z.enum(SHOOT_STATUSES).optional().catch(undefined),
  crew: objectIdString.optional().catch(undefined),
  conflicts: z.enum(["1"]).optional().catch(undefined),
});
export type BoardQuery = z.output<typeof boardQuerySchema>;
