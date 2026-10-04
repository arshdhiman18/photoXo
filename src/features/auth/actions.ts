"use server";

import { headers } from "next/headers";
import { publicAction } from "@/server/actions/safe-action";
import { auth } from "@/server/auth/auth";
import { acceptInvitation } from "@/server/services/invitations.service";
import { acceptInvitationSchema } from "./schemas";

/**
 * Completes invitation setup, then signs the user in (Better Auth sets the
 * session cookie through the nextCookies plugin).
 */
export const acceptInvitationAction = publicAction(acceptInvitationSchema, async (input) => {
  const { email } = await acceptInvitation(input);
  await auth.api.signInEmail({
    body: { email, password: input.password },
    headers: await headers(),
  });
  return { redirectTo: "/" };
});
