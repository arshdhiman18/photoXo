"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import { canManageShoots, canProposeIdeas } from "@/server/authz/permissions";
import {
  addCrew,
  addShootContent,
  cancelShoot,
  completeCrewOnBehalf,
  completeMyPart,
  createShoot,
  getShootOptions,
  removeCrew,
  removeShootContent,
  rescheduleShoot,
  startShoot,
  updateShootDetails,
} from "@/server/services/shoots.service";
import {
  addCrewSchema,
  cancelShootSchema,
  completeOnBehalfSchema,
  createShootSchema,
  crewTargetSchema,
  rescheduleShootSchema,
  shootContentChangeSchema,
  shootOptionsSchema,
  shootTargetSchema,
  updateShootDetailsSchema,
} from "./schemas";

// Managers: canManageShoots before validation. Crew self-service (start /
// complete my part): any internal user; the service checks crew membership
// and the person is always the session user — there is no user-id input.
const managers = { authorize: canManageShoots };
const internal = { authorize: canProposeIdeas };

function revalidateShoots(shootId?: string) {
  revalidatePath("/admin/production");
  revalidatePath("/admin/shoots");
  revalidatePath("/admin/content", "layout");
  revalidatePath("/work", "layout");
  if (shootId) revalidatePath(`/admin/shoots/${shootId}`);
}

export const getShootOptionsAction = authedAction(
  shootOptionsSchema,
  (actor, { brandId, shootId }) => getShootOptions(actor, brandId, shootId),
  managers,
);

export const createShootAction = authedAction(
  createShootSchema,
  async (actor, input) => {
    const res = await createShoot(actor, input);
    revalidateShoots();
    return res;
  },
  managers,
);

export const updateShootDetailsAction = authedAction(
  updateShootDetailsSchema,
  async (actor, input) => {
    await updateShootDetails(actor, input);
    revalidateShoots(input.shootId);
    return null;
  },
  managers,
);

export const rescheduleShootAction = authedAction(
  rescheduleShootSchema,
  async (actor, input) => {
    await rescheduleShoot(actor, input);
    revalidateShoots(input.shootId);
    return null;
  },
  managers,
);

export const addShootContentAction = authedAction(
  shootContentChangeSchema,
  async (actor, { shootId, contentId }) => {
    await addShootContent(actor, shootId, contentId);
    revalidateShoots(shootId);
    return null;
  },
  managers,
);

export const removeShootContentAction = authedAction(
  shootContentChangeSchema,
  async (actor, { shootId, contentId }) => {
    await removeShootContent(actor, shootId, contentId);
    revalidateShoots(shootId);
    return null;
  },
  managers,
);

export const addCrewAction = authedAction(
  addCrewSchema,
  async (actor, input) => {
    await addCrew(actor, input);
    revalidateShoots(input.shootId);
    return null;
  },
  managers,
);

export const removeCrewAction = authedAction(
  crewTargetSchema,
  async (actor, { shootId, crewId }) => {
    await removeCrew(actor, shootId, crewId);
    revalidateShoots(shootId);
    return null;
  },
  managers,
);

export const completeCrewOnBehalfAction = authedAction(
  completeOnBehalfSchema,
  async (actor, { shootId, crewId, reason }) => {
    await completeCrewOnBehalf(actor, shootId, crewId, reason);
    revalidateShoots(shootId);
    return null;
  },
  managers,
);

export const cancelShootAction = authedAction(
  cancelShootSchema,
  async (actor, { shootId, reason }) => {
    await cancelShoot(actor, shootId, reason);
    revalidateShoots(shootId);
    return null;
  },
  managers,
);

export const startShootAction = authedAction(
  shootTargetSchema,
  async (actor, { shootId }) => {
    await startShoot(actor, shootId);
    revalidateShoots(shootId);
    return null;
  },
  internal,
);

export const completeMyPartAction = authedAction(
  shootTargetSchema,
  async (actor, { shootId }) => {
    await completeMyPart(actor, shootId);
    revalidateShoots(shootId);
    return null;
  },
  internal,
);
