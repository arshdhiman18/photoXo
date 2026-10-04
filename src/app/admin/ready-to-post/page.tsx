import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PostingHistoryList, PostingQueueList } from "@/features/postings/components/posting-queue";
import { Workspace } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";
import type { Actor } from "@/server/authz/actor";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canViewPostings } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listPostingHistory, listReadyToPost } from "@/server/services/postings.service";

export const metadata: Metadata = { title: "Ready to Post" };

type Tab = "ready" | "attention" | "posted";

async function load(actor: Actor, tab: Tab) {
  const [items, history, agency] = await Promise.all([
    listReadyToPost(actor),
    tab === "posted" ? listPostingHistory(actor) : Promise.resolve([]),
    getAgencyContext(actor),
  ]);
  return { items, history, timezone: agency.timezone, now: Date.now() };
}

/** Ops overview: everything approved and waiting to be posted, uploader problems first-class. */
export default async function ReadyToPostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canViewPostings(actor)) return <AccessDenied backHref="/admin" />;
  const raw = (await searchParams).tab;
  const tab: Tab = raw === "attention" || raw === "posted" ? raw : "ready";
  const data = await load(actor, tab);
  const attention = data.items.filter((i) => !i.uploader.valid || i.targetPlatforms.length === 0);
  const tabs: [Tab, string][] = [
    ["ready", `Ready to post · ${data.items.length}`],
    ["attention", `Needs attention · ${attention.length}`],
    ["posted", "Posted"],
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Ready to Post" description="Client-approved content waiting for each brand's uploader." />
      <nav aria-label="Posting" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map(([key, label]) => (
            <Link
              key={key}
              href={key === "ready" ? "/admin/ready-to-post" : `/admin/ready-to-post?tab=${key}`}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground [@media(pointer:coarse)]:h-9",
                tab === key && "bg-card font-medium text-foreground shadow-sm",
                key === "attention" && attention.length > 0 && tab !== key && "text-tone-danger",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {tab === "posted" ? (
        <PostingHistoryList items={data.history} hrefBase="/admin/content" timeZone={data.timezone} showPeople />
      ) : (
        <PostingQueueList
          items={tab === "attention" ? attention : data.items}
          hrefBase="/admin/content"
          now={data.now}
          showUploader
          empty={
            tab === "attention"
              ? { title: "Nothing needs attention", description: "Every ready item has a valid uploader and platforms." }
              : { title: "Nothing waiting", description: "Client-approved content appears here until it's posted everywhere." }
          }
        />
      )}
    </div>
  );
}
