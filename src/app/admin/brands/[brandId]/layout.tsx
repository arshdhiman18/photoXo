import Link from "next/link";
import { Archive, ChevronLeft } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { BrandHeaderActions } from "@/features/brands/components/brand-header-actions";
import {
  BrandLogo,
  BrandStatusBadge,
  SocialHandleList,
} from "@/features/brands/components/brand-bits";
import { BrandTabs } from "@/features/brands/components/brand-tabs";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageBrands } from "@/server/authz/permissions";
import { loadAdminBrand } from "./load";

export default async function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brandId: string }>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageBrands(actor)) return <AccessDenied backHref="/admin" />;
  const { brandId } = await params;
  const brand = await loadAdminBrand(actor, brandId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/brands"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Brands
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <BrandLogo name={brand.name} logoUrl={brand.logoUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-[22px]">
                  {brand.name}
                </h1>
                <BrandStatusBadge status={brand.status} />
              </div>
              <SocialHandleList handles={brand.socialHandles} limit={4} className="mt-2" />
            </div>
          </div>
          <BrandHeaderActions brand={brand} />
        </div>
        {brand.status === "ARCHIVED" && (
          <div className="flex items-start gap-2.5 rounded-lg border bg-tone-neutral-bg px-3.5 py-2.5 text-sm">
            <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-pretty text-muted-foreground">
              This brand is archived. Its history and team are kept, but it no longer appears in
              active lists and its team can&apos;t be changed until it&apos;s reactivated.
            </p>
          </div>
        )}
      </div>
      <BrandTabs brandId={brand.id} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
