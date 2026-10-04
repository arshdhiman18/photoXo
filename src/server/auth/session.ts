import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UserStatus, type Workspace } from "@/lib/domain/roles";
import type { Actor } from "@/server/authz/actor";
import { UnauthenticatedError } from "@/server/authz/errors";
import { canAccessWorkspace } from "@/server/authz/permissions";
import { auth } from "./auth";
import { findIdentityById } from "./user-status";

/**
 * Resolve the Actor from request headers. Identity comes ONLY from the
 * session cookie, verified by Better Auth against the `sessions` collection;
 * role/agency/status are then read fresh from the database on every request,
 * so role changes and suspensions apply immediately.
 */
export async function resolveActor(requestHeaders: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const user = await findIdentityById(session.user.id);
  if (!user || user.status !== UserStatus.ACTIVE) return null;

  return Object.freeze({
    userId: String(user._id),
    agencyId: String(user.agencyId),
    systemRole: user.role,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
  });
}

/** Memoised per request (React cache). */
export const getActor = cache(async (): Promise<Actor | null> => resolveActor(await headers()));

/** For server actions / route handlers: throws UnauthenticatedError. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/**
 * For pages & layouts. Unauthenticated → /login. Authenticated but wrong
 * workspace → /forbidden. Each page calls this itself (layouts do not
 * re-run on every navigation, so a layout-only check is not sufficient).
 */
export async function requireWorkspaceActor(workspace: Workspace): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!canAccessWorkspace(actor, workspace)) redirect("/forbidden");
  return actor;
}
