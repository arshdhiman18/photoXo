import type { Metadata } from "next";
import { hashtag } from "@/lib/domain/content";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AssetLinks, CaptionBlock, VersionChip, MediaPreviews } from "@/features/approvals/components/approval-bits";
import { ContentCode, ContentStatusBadge, contentTypeLabel } from "@/features/content/components/content-bits";
import { CopyButton } from "@/features/postings/components/copy-button";
import { UploaderLine } from "@/features/postings/components/posting-bits";
import { PostingHistoryByVersion } from "@/features/postings/components/posting-history";
import { PostingPanel } from "@/features/postings/components/posting-panel";
import { Workspace } from "@/lib/domain/roles";
import { formatDate } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getAgencyContext } from "@/server/services/agency.service";
import { getPostingWorkspace } from "@/server/services/postings.service";

export const metadata: Metadata = { title: "Post" };

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border bg-card shadow-xs">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2 sm:px-5">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Uploader posting page: the approved version, then one card per required platform. */
export default async function PostingPage({ params }: { params: Promise<{ contentId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { contentId } = await params;
  let ws;
  try {
    ws = await getPostingWorkspace(actor, contentId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { timezone } = await getAgencyContext(actor);
  const v = ws.approvedVersion;
  const copyText = v ? [v.caption ?? "", v.hashtags.map(hashtag).join(" ")].filter(Boolean).join("\n\n") : "";

  return (
    <div className="flex flex-col gap-5">
      <Link href="/work/to-post" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Ready to Post
      </Link>
      <header className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {ws.content.brand.name} · {contentTypeLabel(ws.content.contentType)} · <ContentCode code={ws.content.code} />
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance">{ws.content.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ContentStatusBadge status={ws.content.status} />
          <span className="text-sm tabular-nums text-muted-foreground">
            {ws.progress.posted}/{ws.progress.required} platforms posted
          </span>
          <UploaderLine uploader={ws.uploader} />
        </div>
      </header>

      {ws.blockedReason && (
        <p className="rounded-xl border border-tone-warning/30 bg-tone-warning-bg/60 px-4 py-3 text-sm">{ws.blockedReason}</p>
      )}

      {v && (
        <Section
          title="Approved version"
          action={copyText ? <CopyButton text={copyText} /> : undefined}
        >
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <VersionChip n={v.versionNumber} />
              <span className="text-muted-foreground">
                Approved by {v.clientApprovalRecordedByTeam ? "the client (recorded by the team)" : "the client"}
                {v.clientApprovedAt && ` · ${formatDate(v.clientApprovedAt, timezone, { hour: "numeric", minute: "2-digit" })}`}
              </span>
            </p>
            <MediaPreviews assets={v.assets} />
            <AssetLinks assets={v.assets} />
            <CaptionBlock caption={v.caption} hashtags={v.hashtags} />
            <p className="text-xs text-muted-foreground">
              Post this caption and these hashtags exactly. Changes need a new version and fresh approval.
            </p>
          </div>
        </Section>
      )}

      <Section title={`Platforms · ${ws.progress.posted}/${ws.progress.required}`}>
        <PostingPanel ws={ws} timeZone={timezone} />
      </Section>

      {ws.history.some((h) => h.versionNumber !== ws.currentVersionNumber) && (
        <Section title="Earlier posting rounds">
          <PostingHistoryByVersion records={ws.history.filter((h) => h.versionNumber !== ws.currentVersionNumber)} currentVersionNumber={null} timeZone={timezone} />
        </Section>
      )}

      {ws.content.notes && (
        <Section title="Team notes">
          <p className="px-4 py-4 text-sm text-pretty whitespace-pre-line text-muted-foreground sm:px-5">{ws.content.notes}</p>
        </Section>
      )}
    </div>
  );
}
