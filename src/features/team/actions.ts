"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import { canManageUsers } from "@/server/authz/permissions";
import {
  changeUserRole,
  deactivateUser,
  inviteUser,
  reactivateUser,
  resendInvitation,
  revokeInvitation,
  suspendUser,
} from "@/server/services/users.service";
import { changeRoleSchema, inviteUserSchema, targetUserSchema } from "./schemas";

// Thin transport layer: authentication + coarse capability (before input
// validation) via authedAction; target-aware rules in users.service.

const TEAM_PATH = "/admin/team";
const adminOnly = { authorize: canManageUsers };

export const inviteUserAction = authedAction(
  inviteUserSchema,
  async (actor, input) => {
    const result = await inviteUser(actor, input);
    revalidatePath(TEAM_PATH);
    return result;
  },
  adminOnly,
);

export const resendInvitationAction = authedAction(
  targetUserSchema,
  async (actor, { userId }) => {
    const result = await resendInvitation(actor, userId);
    revalidatePath(TEAM_PATH);
    return result;
  },
  adminOnly,
);

export const revokeInvitationAction = authedAction(
  targetUserSchema,
  async (actor, { userId }) => {
    await revokeInvitation(actor, userId);
    revalidatePath(TEAM_PATH);
    return null;
  },
  adminOnly,
);

export const suspendUserAction = authedAction(
  targetUserSchema,
  async (actor, { userId }) => {
    await suspendUser(actor, userId);
    revalidatePath(TEAM_PATH);
    return null;
  },
  adminOnly,
);

export const deactivateUserAction = authedAction(
  targetUserSchema,
  async (actor, { userId }) => {
    await deactivateUser(actor, userId);
    revalidatePath(TEAM_PATH);
    return null;
  },
  adminOnly,
);

export const reactivateUserAction = authedAction(
  targetUserSchema,
  async (actor, { userId }) => {
    const result = await reactivateUser(actor, userId);
    revalidatePath(TEAM_PATH);
    return result;
  },
  adminOnly,
);

export const changeUserRoleAction = authedAction(
  changeRoleSchema,
  async (actor, { userId, role }) => {
    await changeUserRole(actor, userId, role);
    revalidatePath(TEAM_PATH);
    return null;
  },
  adminOnly,
);
