import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { PostingHistoryList, PostingQueueList } from "@/features/postings/components/posting-queue";
import { Workspace } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";
import type { Actor } from "@/server/authz/actor";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { listMyPostingQueue, listPostingHistory } from "@/server/services/postings.service";

export const metadata: Metadata = { title: "Ready to Post" };

async function load(actor: Actor, posted: boolean) {
  const [queue, history, agency] = await Promise.all([
    listMyPostingQueue(actor),
    posted ? listPostingHistory(actor, { mine: true }) : Promise.resolve([]),
    getAgencyContext(actor),
  ]);
  return { queue, history, timezone: agency.timezone, now: Date.now() };
}

/** The uploader's queue: approved content routed to them, and what they've posted. */
export default async function ToPostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const posted = (await searchParams).tab === "posted";
  const data = await load(actor, posted);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Ready to Post" description="Approved content routed to you. Post exactly the approved version." />
      <nav aria-label="Posting" className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        {[
          ["To post", "/work/to-post", !posted],
          ["Posted by me", "/work/to-post?tab=posted", posted],
        ].map(([label, href, on]) => (
          <Link
            key={String(label)}
            href={String(href)}
            aria-current={on ? "page" : undefined}
            className={cn("inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground", on && "bg-card font-medium text-foreground shadow-sm")}
          >
            {label}
            {label === "To post" && ` · ${data.queue.length}`}
          </Link>
        ))}
      </nav>
      {posted ? (
        <PostingHistoryList items={data.history} hrefBase="/work/content" timeZone={data.timezone} />
      ) : (
        <PostingQueueList
          items={data.queue}
          hrefBase="/work/to-post"
          now={data.now}
          empty={{ title: "Nothing to post", description: "When content you upload for is approved by the client, it appears here." }}
        />
      )}
    </div>
  );
}
