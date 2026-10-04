import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckBig, MessageSquareText, ThumbsUp } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ClientApprovalList } from "@/features/approvals/components/client-approval-list";
import { Workspace } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { listClientApprovals } from "@/server/services/approvals.service";

export const metadata: Metadata = { title: "Approvals" };

const TABS = [
  { key: "awaiting", label: "Awaiting approval", icon: CircleCheckBig, empty: ["Nothing needs your approval", "When new content is ready for you, it will appear here."] },
  { key: "changes", label: "Being revised", icon: MessageSquareText, empty: ["No changes in progress", "Content being revised will show here until the new version is ready for you."] },
  { key: "approved", label: "Approved", icon: ThumbsUp, empty: ["Nothing approved yet", "Content you approve is listed here."] },
] as const;

export default async function ClientApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.CLIENT);
  const raw = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === raw) ?? TABS[0];
  const inbox = await listClientApprovals(actor);
  const items = inbox[tab.key];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Hi ${actor.name.split(" ")[0]}`}
        description={inbox.awaiting.length ? `${inbox.awaiting.length} waiting for your approval.` : "You're all caught up."}
      />
      <nav aria-label="Approval status" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "awaiting" ? "/client/approvals" : `/client/approvals?tab=${t.key}`}
              aria-current={t.key === tab.key ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground",
                t.key === tab.key && "bg-card font-medium text-foreground shadow-sm",
              )}
            >
              {t.label} · {inbox[t.key].length}
            </Link>
          ))}
        </div>
      </nav>
      {items.length > 0 ? (
        <ClientApprovalList items={items} />
      ) : (
        <EmptyState icon={tab.icon} title={tab.empty[0]} description={tab.empty[1]} />
      )}
    </div>
  );
}
