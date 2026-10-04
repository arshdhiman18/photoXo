import { randomBytes } from "node:crypto";
import { SystemRole, UserStatus } from "@/lib/domain/roles";
import { auth } from "@/server/auth/auth";
import { setCredentialPassword } from "@/server/auth/sessions";
import { resolveActor } from "@/server/auth/session";
import type { Actor } from "@/server/authz/actor";
import { insertUser } from "@/server/repositories/users.repo";
import { initializeAgencyWithFirstAdmin } from "@/server/services/bootstrap.service";

export const APP_URL = "http://localhost:3000";

export const strongPassword = () => `pw-${randomBytes(12).toString("hex")}`;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: SystemRole;
  agencyId: string;
}

export async function bootstrapAgency(name = "Test Agency"): Promise<TestUser> {
  const password = strongPassword();
  const email = `admin-${randomBytes(3).toString("hex")}@example.test`;
  const { agencyId, userId } = await initializeAgencyWithFirstAdmin({
    agencyName: name,
    adminName: "Ada Admin",
    adminEmail: email,
    adminPassword: password,
    timezone: "Asia/Kolkata",
    currency: "INR",
  });
  return { id: userId, email, password, role: SystemRole.ADMIN, agencyId };
}

/** Test-only shortcut for an already-onboarded user (bypasses the invite email). */
export async function createActiveUser(
  agencyId: string,
  role: SystemRole,
  name = `${role.toLowerCase()} user`,
  status: UserStatus = UserStatus.ACTIVE,
): Promise<TestUser> {
  const email = `${role.toLowerCase()}-${randomBytes(4).toString("hex")}@example.test`;
  const password = strongPassword();
  const user = await insertUser({
    agencyId,
    name,
    email,
    emailVerified: true,
    image: null,
    role,
    status,
    invitedBy: null,
    invitedAt: null,
    activatedAt: new Date(),
    suspendedAt: null,
    deactivatedAt: null,
  });
  await setCredentialPassword(String(user._id), password);
  return { id: String(user._id), email, password, role, agencyId };
}

/** Calls Better Auth's real HTTP endpoint (as a browser would). */
export async function authRequest(path: string, body: unknown, cookie?: string): Promise<Response> {
  return auth.handler(
    new Request(`${APP_URL}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP_URL,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** Signs in through /api/auth/sign-in/email and returns the Cookie header to send back. */
export async function signIn(user: { email: string; password: string }): Promise<string> {
  const res = await authRequest("/sign-in/email", { email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`sign-in failed (${res.status}): ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return cookies.join("; ");
}

export async function actorFromCookie(cookie: string): Promise<Actor | null> {
  return resolveActor(new Headers({ cookie }));
}

export async function signInActor(user: TestUser): Promise<{ cookie: string; actor: Actor }> {
  const cookie = await signIn(user);
  const actor = await actorFromCookie(cookie);
  if (!actor) throw new Error("expected an actor");
  return { cookie, actor };
}
