import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AssetLinks, CaptionBlock, DecisionBadge, MediaPreviews } from "@/features/approvals/components/approval-bits";
import { ClientDecisionBar } from "@/features/approvals/components/client-decision-bar";
import { contentTypeLabel } from "@/features/content/components/content-bits";
import { POSTING_PLATFORM_LABEL } from "@/lib/domain/postings";
import { Workspace } from "@/lib/domain/roles";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getAgencyContext } from "@/server/services/agency.service";
import { getClientReview } from "@/server/services/approvals.service";

export const metadata: Metadata = { title: "Review" };

const STATE_STYLE = {
  AWAITING: "bg-tone-info-bg text-tone-info",
  CHANGES: "bg-tone-warning-bg text-tone-warning",
  APPROVED: "bg-tone-success-bg text-tone-success",
} as const;

/** What the client is approving: one exact version — media, caption, hashtags. */
export default async function ClientContentReviewPage({ params }: { params: Promise<{ contentId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.CLIENT);
  const { contentId } = await params;
  let c;
  try {
    c = await getClientReview(actor, contentId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { timezone } = await getAgencyContext(actor);
  const v = c.version;
  const back =
    c.state === "AWAITING" ? "/client/approvals" : `/client/approvals?tab=${c.state === "CHANGES" ? "changes" : "approved"}`;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={back}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Approvals
      </Link>
      <header>
        <p className="text-sm text-muted-foreground">
          {c.brand.name} · {contentTypeLabel(c.contentType)}
        </p>
        <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight text-balance">{c.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-sm font-medium", STATE_STYLE[c.state])}>
            {c.statusLabel}
          </span>
          {v && <span className="text-sm text-muted-foreground">Version {v.versionNumber}</span>}
        </p>
      </header>

      {c.state === "CHANGES" && (
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-pretty text-muted-foreground shadow-xs">
          A new version of this content is being prepared. It will appear here for your approval.
        </p>
      )}

      {v ? (
        <section aria-label="Creation" className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
          <div>
            <MediaPreviews assets={v.assets} />
            <h2 className="mb-2 text-sm font-medium">Open the creation</h2>
            {v.assets.some((a) => a.url) ? (
              <AssetLinks assets={v.assets} large />
            ) : (
              <p className="text-sm text-muted-foreground">No files attached.</p>
            )}
          </div>
          {(v.caption || v.hashtags.length > 0) && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Caption &amp; hashtags</h2>
              <CaptionBlock caption={v.caption} hashtags={v.hashtags} />
            </div>
          )}
        </section>
      ) : (
        <p className="rounded-xl border border-dashed bg-subtle px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing to show yet.
        </p>
      )}

      {c.posts.length > 0 && (
        <section aria-labelledby="client-live" className="rounded-xl border bg-card shadow-xs">
          <h2 id="client-live" className="border-b px-4 py-3 text-sm font-medium sm:px-5">
            Live on
          </h2>
          <ul className="divide-y">
            {c.posts.map((p) => (
              <li key={p.platform} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                <span className="text-sm font-medium">{POSTING_PLATFORM_LABEL[p.platform]}</span>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm text-tone-info hover:underline">
                  {p.url}
                </a>
                <span className="text-xs text-muted-foreground">{formatDate(p.postedAt, timezone)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.history.length > 0 && (
        <section aria-labelledby="client-history" className="rounded-xl border bg-card shadow-xs">
          <h2 id="client-history" className="border-b px-4 py-3 text-sm font-medium sm:px-5">
            History
          </h2>
          <ol className="divide-y">
            {c.history.map((h) => (
              <li key={h.id} className="flex flex-col gap-1 px-4 py-3 sm:px-5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <DecisionBadge decision={h.decision} />
                  <span className="text-muted-foreground">Version {h.versionNumber}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {h.byLabel} · {formatDate(h.decidedAt, timezone, { hour: "numeric", minute: "2-digit" })}
                </p>
                {h.comment && <p className="text-sm text-pretty whitespace-pre-line">{h.comment}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {c.canDecide && v && <ClientDecisionBar contentId={c.id} versionId={v.id} versionNumber={v.versionNumber} />}
    </div>
  );
}
