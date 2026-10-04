"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import { canManageBrands, canManageBrandTeam } from "@/server/authz/permissions";
import {
  addMember,
  changeMemberRole,
  deactivateMember,
  reactivateMember,
  searchMemberCandidates,
  setPrimaryUploader,
} from "@/server/services/brand-team.service";
import {
  archiveBrand,
  createBrand,
  reactivateBrand,
  updateBrand,
} from "@/server/services/brands.service";
import {
  addMemberSchema,
  brandTargetSchema,
  candidateSearchSchema,
  changeMemberRoleSchema,
  createBrandSchema,
  membershipTargetSchema,
  setPrimaryUploaderSchema,
  updateBrandSchema,
} from "./schemas";

// Capability is checked BEFORE input validation (authorize); brand visibility
// and target rules are enforced in the services. A brandId the actor cannot
// see is a NOT_FOUND, whatever the action.

const brandAdmin = { authorize: canManageBrands };
const teamAdmin = { authorize: canManageBrandTeam };

function revalidateBrand(brandId?: string) {
  revalidatePath("/admin/brands");
  revalidatePath("/admin/team");
  if (brandId) revalidatePath(`/admin/brands/${brandId}`, "layout");
}

export const createBrandAction = authedAction(
  createBrandSchema,
  async (actor, input) => {
    const result = await createBrand(actor, input);
    revalidateBrand();
    return result;
  },
  brandAdmin,
);

export const updateBrandAction = authedAction(
  updateBrandSchema,
  async (actor, input) => {
    const brand = await updateBrand(actor, input);
    revalidateBrand(input.brandId);
    return brand;
  },
  brandAdmin,
);

export const archiveBrandAction = authedAction(
  brandTargetSchema,
  async (actor, { brandId }) => {
    await archiveBrand(actor, brandId);
    revalidateBrand(brandId);
    return null;
  },
  brandAdmin,
);

export const reactivateBrandAction = authedAction(
  brandTargetSchema,
  async (actor, { brandId }) => {
    await reactivateBrand(actor, brandId);
    revalidateBrand(brandId);
    return null;
  },
  brandAdmin,
);

// ── Team ───────────────────────────────────────────────────────────────────

export const searchMemberCandidatesAction = authedAction(
  candidateSearchSchema,
  (actor, input) => searchMemberCandidates(actor, input),
  teamAdmin,
);

export const addMemberAction = authedAction(
  addMemberSchema,
  async (actor, input) => {
    const result = await addMember(actor, input);
    revalidateBrand(input.brandId);
    return result;
  },
  teamAdmin,
);

export const deactivateMemberAction = authedAction(
  membershipTargetSchema,
  async (actor, input) => {
    await deactivateMember(actor, input);
    revalidateBrand(input.brandId);
    return null;
  },
  teamAdmin,
);

export const reactivateMemberAction = authedAction(
  membershipTargetSchema,
  async (actor, input) => {
    await reactivateMember(actor, input);
    revalidateBrand(input.brandId);
    return null;
  },
  teamAdmin,
);

export const changeMemberRoleAction = authedAction(
  changeMemberRoleSchema,
  async (actor, input) => {
    const result = await changeMemberRole(actor, input);
    revalidateBrand(input.brandId);
    return result;
  },
  teamAdmin,
);

export const setPrimaryUploaderAction = authedAction(
  setPrimaryUploaderSchema,
  async (actor, input) => {
    await setPrimaryUploader(actor, input);
    revalidateBrand(input.brandId);
    return null;
  },
  teamAdmin,
);
