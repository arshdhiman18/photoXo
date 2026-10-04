import type { Metadata } from "next";
import { Clapperboard } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ClientContentList } from "@/features/content/components/client-content-list";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { listContentForClient } from "@/server/services/content.service";

export const metadata: Metadata = { title: "Content" };

export default async function ClientContentPage() {
  const actor = await requireWorkspaceActor(Workspace.CLIENT);
  const items = await listContentForClient(actor);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content"
        description="Everything shared with you for review, and what has been approved."
      />
      {items.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No content shared yet"
          description="Content sent for your review will be listed here."
        />
      ) : (
        <ClientContentList items={items} />
      )}
    </div>
  );
}
