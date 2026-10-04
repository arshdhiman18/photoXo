import { QueueTabs, RecentDecisionsList, ReviewQueueList, type QueueTab } from "@/features/approvals/components/review-queue";
import { recentDecisionsQuerySchema } from "@/features/approvals/schemas";
import type { Actor } from "@/server/authz/actor";
import { getAgencyContext } from "@/server/services/agency.service";
import { listRecentDecisions, listReviewQueues } from "@/server/services/approvals.service";

const TABS: QueueTab[] = ["internal", "client", "changes", "decisions"];

/** Shared by the agency Approvals page and the brand Approvals tab. */
export async function loadApprovals(actor: Actor, rawTab: unknown, brandId?: string) {
  const tab: QueueTab = TABS.includes(rawTab as QueueTab) ? (rawTab as QueueTab) : "internal";
  const [queues, decisions, agency] = await Promise.all([
    listReviewQueues(actor, { brandId }),
    tab === "decisions" ? listRecentDecisions(actor, recentDecisionsQuerySchema.parse({ brand: brandId })) : Promise.resolve([]),
    getAgencyContext(actor),
  ]);
  return { tab, queues, decisions, timezone: agency.timezone, now: Date.now() };
}

export function ApprovalsBody({ base, data }: { base: string; data: Awaited<ReturnType<typeof loadApprovals>> }) {
  const { tab, queues } = data;
  return (
    <div className="flex flex-col gap-4">
      <QueueTabs
        base={base}
        tab={tab}
        counts={{ internal: queues.internal.length, client: queues.client.length, changes: queues.changes.length }}
      />
      {tab === "decisions" ? (
        <RecentDecisionsList items={data.decisions} timeZone={data.timezone} />
      ) : (
        <ReviewQueueList items={queues[tab]} tab={tab} now={data.now} />
      )}
    </div>
  );
}

