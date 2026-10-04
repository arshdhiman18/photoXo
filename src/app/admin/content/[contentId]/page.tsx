import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import {
  ContentCode,
  ContentStatusBadge,
  contentTypeLabel,
  DueDate,
  originLabel,
  PriorityMark,
} from "@/features/content/components/content-bits";
import {
  AddVersionButton,
  ArchiveContentButton,
  CancelContentButton,
  ChangeRouteButton,
  EditContentButton,
  IdeaReviewPanel,
  UploaderPanel,
} from "@/features/content/components/content-panels";
import { ApprovalHistoryList } from "@/features/approvals/components/approval-bits";
import { ReviewPanel } from "@/features/approvals/components/review-panel";
import { ReferenceCard } from "@/features/content/components/reference-card";
import { TaskPanel } from "@/features/content/components/task-panel";
import { VersionsList } from "@/features/content/components/versions-list";
import {
  ARCHIVABLE_STATUSES,
  PRODUCTION_ROUTE_DEFS,
  PRODUCTION_STATUSES,
  ROUTE_EDITABLE_STATUSES,
  canTransition,
} from "@/lib/domain/content";
import { Workspace } from "@/lib/domain/roles";
import { formatCalendarDate, formatDate, todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { canManageContent } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { mediaEnabled } from "@/server/services/media.service";
import { getReviewState } from "@/server/services/approvals.service";
import { getPostingWorkspace } from "@/server/services/postings.service";
import { PostingPanel } from "@/features/postings/components/posting-panel";
import { UploaderLine } from "@/features/postings/components/posting-bits";
import { ReopenForChangesButton, StartRevisionButton, TargetPlatformsControl } from "@/features/postings/components/posting-admin-controls";
import { PostingHistoryByVersion } from "@/features/postings/components/posting-history";
import { getContentActivity, getContentForAdmin } from "@/server/services/content.service";
import { shootsForContent } from "@/server/services/shoots.service";
import { ShootStatusBadge, TimeRange } from "@/features/shoots/components/shoot-bits";

export const metadata: Metadata = { title: "Content" };

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
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

export default async function AdminContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageContent(actor)) return <AccessDenied backHref="/admin" />;
  const { contentId } = await params;

  let c;
  try {
    c = await getContentForAdmin(actor, contentId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [{ timezone }, shoots, review, posting] = await Promise.all([
    getAgencyContext(actor),
    shootsForContent(actor, c.id),
    getReviewState(actor, c.id),
    getPostingWorkspace(actor, c.id),
  ]);
  const activity = await getContentActivity(actor, c.id);
  // The posting round is shown only while one is open/finished; earlier rounds live in the history below.
  const showPosting = ["READY_TO_POST", "POSTED", "COMPLETED"].includes(c.status);
  const productionOpen = PRODUCTION_STATUSES.includes(c.status) && !c.archivedAt;
  const editable = !c.archivedAt;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/content"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Content
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <ContentCode code={c.code} /> · {contentTypeLabel(c.contentType)} ·{" "}
              {originLabel(c.origin)}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance sm:text-[22px]">
              {c.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <Link href={`/admin/brands/${c.brand.id}`} className="font-medium hover:underline">
                {c.brand.name}
              </Link>
              <ContentStatusBadge status={c.status} />
              <PriorityMark priority={c.priority} />
              {c.dueDate && (
                <span className="text-muted-foreground">
                  Due{" "}
                  <DueDate iso={c.dueDate} timeZone={timezone} today={todayInTimeZone(timezone)} />
                </span>
              )}
              {c.archivedAt && <span className="text-muted-foreground">Archived</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && (
              <EditContentButton
                full
                content={{
                  id: c.id,
                  brandId: c.brand.id,
                  title: c.title,
                  description: c.description,
                  notes: c.notes,
                  contentType: c.contentType,
                  priority: c.priority,
                  dueDate: c.dueDate,
                  references: c.references,
                }}
              />
            )}
            {canTransition(c.status, "CANCELLED") && <CancelContentButton contentId={c.id} />}
            {!c.archivedAt && ARCHIVABLE_STATUSES.includes(c.status) && (
              <ArchiveContentButton contentId={c.id} />
            )}
          </div>
        </div>
      </div>

      {c.origin === "TEAM_IDEA" && c.status === "PROPOSED" && (
        <IdeaReviewPanel contentId={c.id} review={c.ideaReview} />
      )}
      {c.ideaReview && c.status === "REJECTED" && (
        <p className="rounded-xl border bg-tone-danger-bg/50 px-4 py-3 text-sm">
          <span className="font-medium">Idea rejected</span>
          {c.ideaReview.decidedBy && ` by ${c.ideaReview.decidedBy.name}`}
          {c.ideaReview.note && `: ${c.ideaReview.note}`}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {(c.versions.length > 0 || review.history.length > 0) && (
            <Section title="Review">
              <ReviewPanel state={review} versions={c.versions} timeZone={timezone} />
            </Section>
          )}

          {showPosting && (
            <Section
              title={`Posting · ${posting.progress.posted}/${posting.progress.required}`}
              action={
                posting.canReopen && posting.approvedVersion ? (
                  <ReopenForChangesButton contentId={c.id} versionId={posting.approvedVersion.id} />
                ) : posting.canStartRevision ? (
                  <StartRevisionButton contentId={c.id} />
                ) : undefined
              }
            >
              <div className="flex flex-col gap-1 border-b px-4 py-3 sm:px-5">
                <UploaderLine uploader={posting.uploader} />
                {posting.blockedReason && <p className="text-sm text-tone-warning">{posting.blockedReason}</p>}
                {posting.completedAt && (
                  <p className="text-sm text-tone-success">Completed {formatDate(posting.completedAt, timezone, { hour: "numeric", minute: "2-digit" })}</p>
                )}
              </div>
              <PostingPanel ws={posting} timeZone={timezone} internalDetail />
            </Section>
          )}

          {posting.history.length > 0 && (
            <Section title="Posting history by version">
              <PostingHistoryByVersion
                records={posting.history}
                currentVersionNumber={showPosting ? posting.currentVersionNumber : null}
                timeZone={timezone}
              />
            </Section>
          )}

          <Section title={c.origin === "TEAM_IDEA" ? "Idea" : "Brief"}>
            <div className="px-4 py-4 sm:px-5">
              {c.description ? (
                <p className="text-sm text-pretty whitespace-pre-line">{c.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {c.origin === "TEAM_IDEA" ? "No description yet." : "No brief written yet."}
                </p>
              )}
            </div>
          </Section>

          <Section
            title="Production"
            action={
              editable && ROUTE_EDITABLE_STATUSES.includes(c.status) ? (
                <ChangeRouteButton contentId={c.id} route={c.route} />
              ) : undefined
            }
          >
            <TaskPanel
              contentId={c.id}
              route={c.route}
              tasks={c.tasks}
              manage
              productionOpen={productionOpen}
            />
          </Section>

          <Section
            title={`Versions${c.versions.length ? ` · ${c.versions.length}` : ""}`}
            action={
              productionOpen ? (
                <AddVersionButton
                  contentId={c.id}
                  mediaEnabled={mediaEnabled()}
                  nextNumber={(c.versions[0]?.versionNumber ?? 0) + 1}
                />
              ) : undefined
            }
          >
            <VersionsList versions={c.versions} timeZone={timezone} />
          </Section>

          <Section title={`Approval history${review.history.length ? ` · ${review.history.length}` : ""}`}>
            <ApprovalHistoryList items={review.history} timeZone={timezone} />
          </Section>

          <Section title={`Activity · ${activity.length}`}>
            {activity.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No activity yet.</p>
            ) : (
              <details>
                <summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground sm:px-5">Show the full history</summary>
                <ol className="divide-y border-t">
                  {activity.map((e) => (
                    <li key={e.id} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-3 sm:px-5">
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums sm:w-36">
                        {formatDate(e.at, timezone, { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">{e.label}</span>
                        {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
                        {e.detail && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{e.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </Section>

          <Section title={`References${c.references.length ? ` · ${c.references.length}` : ""}`}>
            {c.references.length ? (
              <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                {c.references.map((r) => (
                  <ReferenceCard key={r.id} reference={r} />
                ))}
              </div>
            ) : (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
                No references — that&apos;s fine. Add one via Edit if useful.
              </p>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {shoots.length > 0 && (
            <Section title="Shoots">
              <ul className="divide-y">
                {shoots.map((sh) => (
                  <li key={sh.id}>
                    <Link href={`/admin/shoots/${sh.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/50 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{sh.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatCalendarDate(sh.date)} · <TimeRange start={sh.startTime} end={sh.endTime} />
                        </span>
                      </span>
                      <ShootStatusBadge status={sh.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Post to">
            <div className="px-4 py-4 sm:px-5">
              <TargetPlatformsControl contentId={c.id} value={posting.targetPlatforms} editable={posting.canEditPlatforms} />
            </div>
          </Section>
          <Section title="Content uploader">
            <UploaderPanel contentId={c.id} info={c.uploader} editable={editable} />
          </Section>
          <Section title="Details">
            <dl className="grid gap-2.5 px-4 py-4 text-sm sm:px-5">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Route</dt>
                <dd className="text-right">{PRODUCTION_ROUTE_DEFS[c.route].label}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Created by</dt>
                <dd className="truncate text-right">{c.createdBy?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-right">{formatDate(c.createdAt, timezone)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="text-right">{formatDate(c.updatedAt, timezone)}</dd>
              </div>
            </dl>
          </Section>
          <Section title="Internal notes">
            <p className="px-4 py-4 text-sm text-pretty whitespace-pre-line text-muted-foreground sm:px-5">
              {c.notes ?? "None. Notes are never shown to clients."}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
