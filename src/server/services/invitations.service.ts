import "server-only";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { SYSTEM_ROLE_LABEL, UserStatus } from "@/lib/domain/roles";
import { recordActivity } from "@/server/activity/record";
import { AppError, NotFoundError } from "@/server/authz/errors";
import { setCredentialPassword } from "@/server/auth/sessions";
import { hashToken, isWellFormedToken } from "@/server/auth/tokens";
import { activateInvitedUser, findUserForInvitation } from "@/server/repositories/identity.repo";
import { getAgencyById } from "@/server/repositories/agency.repo";
import {
  claimInvitation,
  findInvitationByTokenHash,
  releaseInvitationClaim,
} from "@/server/repositories/invitations.repo";

export type InvitationState =
  | { state: "valid"; name: string; email: string; roleLabel: string; agencyName: string }
  | { state: "invalid" | "expired" | "used" };

/** Pre-authentication preview for /invite/[token]. Reveals nothing for bad tokens. */
export async function previewInvitation(token: string): Promise<InvitationState> {
  if (!isWellFormedToken(token)) return { state: "invalid" };
  const inv = await findInvitationByTokenHash(hashToken(token));
  if (!inv || inv.revokedAt) return { state: "invalid" };
  if (inv.acceptedAt) return { state: "used" };
  if (inv.expiresAt <= new Date()) return { state: "expired" };

  const user = await findUserForInvitation(inv.userId);
  if (!user || user.status !== UserStatus.INVITED) return { state: "invalid" };
  const agency = await getAgencyById(inv.agencyId);

  return {
    state: "valid",
    name: user.name,
    email: user.email,
    roleLabel: SYSTEM_ROLE_LABEL[user.role],
    agencyName: agency?.name ?? "your agency",
  };
}

/**
 * Complete account setup. The invitation is claimed atomically (single use),
 * the password is stored via Better Auth's hashing, then the user becomes
 * ACTIVE. On failure after the claim, the claim is released.
 */
export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ email: string }> {
  const invalid = new AppError(
    "NOT_FOUND",
    "This invitation link is invalid or has expired. Ask your administrator to resend it.",
  );
  if (!isWellFormedToken(input.token)) throw invalid;

  const claimed = await claimInvitation(hashToken(input.token), new Date());
  if (!claimed) throw invalid;

  try {
    const user = await findUserForInvitation(claimed.userId);
    if (!user || user.status !== UserStatus.INVITED) throw new NotFoundError();

    await setCredentialPassword(String(user._id), input.password);
    const activated = await activateInvitedUser(user._id, input.name);
    if (!activated) throw new NotFoundError();

    await recordActivity({
      actor: { system: true, agencyId: String(claimed.agencyId) },
      action: ActivityAction.USER_ACTIVATED,
      entity: { kind: ActivityEntityKind.USER, id: String(user._id) },
      meta: { via: "invitation" },
    });
    return { email: user.email };
  } catch (error) {
    await releaseInvitationClaim(claimed._id);
    if (error instanceof NotFoundError) throw invalid;
    throw error;
  }
}
