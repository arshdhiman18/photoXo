import "server-only";
import { auth } from "./auth";

/** Revoke every session of a user (suspension, deactivation, password reset). */
export async function revokeAllSessions(userId: string): Promise<void> {
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}

/**
 * Create or replace the user's email/password credential using Better Auth's
 * own hashing (scrypt) and account storage, so sign-in verifies normally.
 */
export async function setCredentialPassword(userId: string, password: string): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const existing = await ctx.internalAdapter.findCredentialAccount(userId);
  if (existing) {
    await ctx.internalAdapter.updatePassword(userId, hash);
  } else {
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hash,
    });
  }
}

export async function hasCredentialAccount(userId: string): Promise<boolean> {
  const ctx = await auth.$context;
  return Boolean(await ctx.internalAdapter.findCredentialAccount(userId));
}
