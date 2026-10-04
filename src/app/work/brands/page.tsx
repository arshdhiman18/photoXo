import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { MyBrandCard } from "@/features/brands/components/my-brand-card";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { listMyBrands } from "@/server/services/brands.service";

export const metadata: Metadata = { title: "My brands" };

export default async function MyBrandsPage() {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const brands = await listMyBrands(actor);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My brands"
        description="Brands you're assigned to, and your role on each."
      />
      {brands.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="You're not assigned to any brand yet"
          description="When an admin adds you to a brand team, it will appear here."
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {brands.map((b) => (
            <li key={b.id}>
              <MyBrandCard brand={b} href={`/work/brands/${b.id}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
