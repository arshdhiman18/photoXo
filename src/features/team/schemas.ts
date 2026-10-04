import { z } from "zod";
import { INVITABLE_ROLES, SYSTEM_ROLES, USER_STATUSES } from "@/lib/domain/roles";
import { emailAddress, objectIdString, personName } from "@/lib/validation";

// All mutation schemas are .strict(): unexpected keys (agencyId, status,
// invitedBy, …) are rejected rather than silently dropped.

export const inviteUserSchema = z
  .object({
    name: personName,
    email: emailAddress,
    role: z.enum(INVITABLE_ROLES, { error: "Choose a role" }),
  })
  .strict();
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const targetUserSchema = z.object({ userId: objectIdString }).strict();

export const changeRoleSchema = z
  .object({ userId: objectIdString, role: z.enum(INVITABLE_ROLES) })
  .strict();

export const TEAM_PAGE_SIZE = 25;

/** Parsing of URL search params for the team list (invalid values are dropped). */
export const teamListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  role: z.enum(SYSTEM_ROLES).optional().catch(undefined),
  status: z.enum(USER_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type TeamListQuery = z.output<typeof teamListQuerySchema>;
