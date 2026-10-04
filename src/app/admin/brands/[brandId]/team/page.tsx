import type { Metadata } from "next";
import { BrandTeamPanel } from "@/features/brands/components/brand-team-panel";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getBrandTeam } from "@/server/services/brand-team.service";
import { loadAdminBrand } from "../load";

export const metadata: Metadata = { title: "Brand team" };

export default async function BrandTeamPage({ params }: { params: Promise<{ brandId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const { brandId } = await params;
  const brand = await loadAdminBrand(actor, brandId);
  const team = await getBrandTeam(actor, brandId);
  return (
    <BrandTeamPanel
      brandId={brand.id}
      brandName={brand.name}
      archived={brand.status === "ARCHIVED"}
      team={team}
    />
  );
}
