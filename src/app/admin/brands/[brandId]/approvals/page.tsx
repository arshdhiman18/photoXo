import type { Metadata } from "next";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { ApprovalsBody, loadApprovals } from "@/app/admin/approvals/approvals-view";
import { loadAdminBrand } from "../load";

export const metadata: Metadata = { title: "Brand approvals" };

export default async function BrandApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const brand = await loadAdminBrand(actor, (await params).brandId);
  const data = await loadApprovals(actor, (await searchParams).tab, brand.id);
  return <ApprovalsBody base={`/admin/brands/${brand.id}/approvals`} data={data} />;
}
