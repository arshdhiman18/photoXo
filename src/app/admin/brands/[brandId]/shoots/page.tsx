import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShootBoard } from "@/features/shoots/components/shoot-board";
import { Workspace } from "@/lib/domain/roles";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { listShootsForAdmin } from "@/server/services/shoots.service";
import { loadAdminBrand } from "../load";

export const metadata: Metadata = { title: "Brand shoots" };

export default async function BrandShootsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const brand = await loadAdminBrand(actor, (await params).brandId);
  const { timezone } = await getAgencyContext(actor);
  const today = todayInTimeZone(timezone);
  const data = await listShootsForAdmin(actor, { brand: brand.id, from: addDays(today, -30), to: addDays(today, 90) });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Last 30 days and next 90 days.</p>
        {brand.status === "ACTIVE" && (
          <Button asChild variant="outline">
            <Link href={`/admin/shoots/new?brand=${brand.id}`}>
              <Plus data-icon="inline-start" />
              New shoot
            </Link>
          </Button>
        )}
      </div>
      <ShootBoard items={data.items} today={today} emptyTitle="No shoots for this brand" />
    </div>
  );
}
