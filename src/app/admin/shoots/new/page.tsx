import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { ShootForm } from "@/features/shoots/components/shoot-form";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageShoots } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listBrandOptions } from "@/server/services/brands.service";

export const metadata: Metadata = { title: "Schedule a shoot" };

export default async function NewShootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageShoots(actor)) return <AccessDenied backHref="/admin" />;
  const sp = await searchParams;
  const [brands, agency] = await Promise.all([listBrandOptions(actor), getAgencyContext(actor)]);
  const brand = typeof sp.brand === "string" && brands.some((b) => b.id === sp.brand) ? sp.brand : undefined;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayInTimeZone(agency.timezone);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href="/admin/production" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Production
      </Link>
      <PageHeader title="Schedule a shoot" description="One shoot can produce many pieces of content for one brand." />
      <ShootForm brands={brands} defaultBrandId={brand} defaultDate={date} />
    </div>
  );
}
