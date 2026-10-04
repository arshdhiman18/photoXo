import type { Metadata } from "next";
import { Library } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ClientApprovalList } from "@/features/approvals/components/client-approval-list";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { listClientApprovals } from "@/server/services/approvals.service";

export const metadata: Metadata = { title: "Library" };

export default async function ClientLibraryPage() {
  const actor = await requireWorkspaceActor(Workspace.CLIENT);
  const { approved } = await listClientApprovals(actor);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Library" description="Everything you've approved." />
      {approved.length > 0 ? (
        <ClientApprovalList items={approved} />
      ) : (
        <EmptyState
          icon={Library}
          title="Your library is empty"
          description="Approved content will be collected here."
        />
      )}
    </div>
  );
}
