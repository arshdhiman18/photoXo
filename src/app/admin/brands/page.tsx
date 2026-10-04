import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { NewBrandButton } from "@/features/brands/components/brand-form-dialog";
import { BrandsList } from "@/features/brands/components/brands-list";
import { BrandsToolbar } from "@/features/brands/components/brands-toolbar";
import { brandListQuerySchema } from "@/features/brands/schemas";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageBrands } from "@/server/authz/permissions";
import { listBrands } from "@/server/services/brands.service";

export const metadata: Metadata = { title: "Brands" };

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageBrands(actor)) return <AccessDenied backHref="/admin" />;

  const raw = await searchParams;
  const query = brandListQuerySchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const data = await listBrands(actor, query);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Brands"
        description="Brands, their teams, Content Uploaders and client users."
        actions={<NewBrandButton />}
      />
      <BrandsToolbar query={query} counts={data.statusCounts} />
      <BrandsList data={data} query={query} />
    </div>
  );
}
