import "server-only";
import { notFound } from "next/navigation";
import type { BrandDetailDTO } from "@/features/brands/types";
import type { Actor } from "@/server/authz/actor";
import { isAppError } from "@/server/authz/errors";
import { getBrandForAdmin } from "@/server/services/brands.service";

/** Brand for admin pages; ids outside the actor's scope render the 404 page. */
export async function loadAdminBrand(actor: Actor, brandId: string): Promise<BrandDetailDTO> {
  try {
    return await getBrandForAdmin(actor, brandId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
