import "server-only";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { SystemRole, UserStatus } from "@/lib/domain/roles";
import { recordActivity } from "@/server/activity/record";
import { ConflictError } from "@/server/authz/errors";
import { setCredentialPassword } from "@/server/auth/sessions";
import { connectDb, getDb } from "@/server/db/connect";
import { countAgencies, insertAgency } from "@/server/repositories/agency.repo";
import { emailIsTaken, insertUser } from "@/server/repositories/users.repo";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "agency"
  );
}

/**
 * One-time initialisation: creates the agency and its first ADMIN with a
 * password. Refuses to run once any agency exists, so it cannot be used to
 * mint additional admins. Only reachable from the CLI (scripts/create-admin.ts),
 * never from an HTTP route.
 */
export async function initializeAgencyWithFirstAdmin(input: {
  agencyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  timezone: string;
  currency: string;
}): Promise<{ agencyId: string; userId: string }> {
  await connectDb();
  if ((await countAgencies()) > 0) {
    throw new ConflictError(
      "PhotoXo is already initialised. Additional admins cannot be created with this command.",
    );
  }
  if (await emailIsTaken(input.adminEmail)) {
    throw new ConflictError("A user with that email already exists.");
  }

  // Atomic one-time marker: a fixed _id can only be inserted once, so two
  // concurrent runs cannot both initialise.
  try {
    await getDb()
      .collection<{ _id: string; at: Date }>("system")
      .insertOne({ _id: "bootstrap", at: new Date() });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ConflictError("PhotoXo is already initialised.");
    }
    throw error;
  }

  const agency = await insertAgency({
    name: input.agencyName,
    slug: slugify(input.agencyName),
    timezone: input.timezone,
    currency: input.currency,
  });

  const now = new Date();
  const user = await insertUser({
    agencyId: String(agency._id),
    name: input.adminName,
    email: input.adminEmail,
    emailVerified: true,
    image: null,
    role: SystemRole.ADMIN,
    status: UserStatus.ACTIVE,
    invitedBy: null,
    invitedAt: null,
    activatedAt: now,
    suspendedAt: null,
    deactivatedAt: null,
  });
  await setCredentialPassword(String(user._id), input.adminPassword);

  const system = { system: true as const, agencyId: String(agency._id) };
  await recordActivity({
    actor: system,
    action: ActivityAction.AGENCY_INITIALIZED,
    entity: { kind: ActivityEntityKind.AGENCY, id: String(agency._id) },
    meta: { name: input.agencyName },
  });
  await recordActivity({
    actor: system,
    action: ActivityAction.USER_ACTIVATED,
    entity: { kind: ActivityEntityKind.USER, id: String(user._id) },
    meta: { via: "create-admin", role: SystemRole.ADMIN },
  });

  return { agencyId: String(agency._id), userId: String(user._id) };
}
