"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import { updateOwnProfile } from "@/server/services/account.service";
import { updateProfileSchema } from "./schemas";

export const updateProfileAction = authedAction(updateProfileSchema, async (actor, input) => {
  const self = await updateOwnProfile(actor, input);
  revalidatePath("/", "layout");
  return self;
});
