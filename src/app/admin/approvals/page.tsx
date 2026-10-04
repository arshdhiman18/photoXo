import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageClientApprovals } from "@/server/authz/permissions";
import { ApprovalsBody, loadApprovals } from "./approvals-view";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageClientApprovals(actor)) return <AccessDenied backHref="/admin" />;
  const data = await loadApprovals(actor, (await searchParams).tab);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Approvals" description="Internal review first, then the client. Open an item to review the exact version." />
      <ApprovalsBody base="/admin/approvals" data={data} />
    </div>
  );
}
