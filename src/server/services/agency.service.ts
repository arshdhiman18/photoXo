import "server-only";
import type { Actor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/authz/errors";
import { assertCan, canManageSettings } from "@/server/authz/permissions";
import { getOwnAgency } from "@/server/repositories/agency.repo";

export interface AgencyContext {
  name: string;
  timezone: string;
  currency: string;
}

/** Minimal agency context any member may read (used for dates, currency, branding). */
export async function getAgencyContext(actor: Actor): Promise<AgencyContext> {
  const agency = await getOwnAgency(actor);
  if (!agency) throw new NotFoundError();
  return { name: agency.name, timezone: agency.timezone, currency: agency.currency };
}

export async function getAgencySettings(
  actor: Actor,
): Promise<AgencyContext & { createdAt: string }> {
  assertCan(canManageSettings(actor));
  const agency = await getOwnAgency(actor);
  if (!agency) throw new NotFoundError();
  return {
    name: agency.name,
    timezone: agency.timezone,
    currency: agency.currency,
    createdAt: agency.createdAt.toISOString(),
  };
}
