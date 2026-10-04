import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  ContentCode,
  ContentStatusBadge,
  contentTypeLabel,
  DueDate,
  PriorityMark,
} from "@/features/content/components/content-bits";
import {
  AddVersionButton,
  EditContentButton,
  IdeaChangesBanner,
} from "@/features/content/components/content-panels";
import { ApprovalHistoryList } from "@/features/approvals/components/approval-bits";
import { ReviewPanel } from "@/features/approvals/components/review-panel";
import { ReferenceCard } from "@/features/content/components/reference-card";
import { TaskPanel } from "@/features/content/components/task-panel";
import { VersionsList } from "@/features/content/components/versions-list";
import { PRODUCTION_STATUSES } from "@/lib/domain/content";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getAgencyContext } from "@/server/services/agency.service";
import { mediaEnabled } from "@/server/services/media.service";
import { getReviewState } from "@/server/services/approvals.service";
import { getContentForStaff } from "@/server/services/content.service";

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
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function StaffContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { contentId } = await params;
  let c;
  try {
    c = await getContentForStaff(actor, contentId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [{ timezone }, review] = await Promise.all([getAgencyContext(actor), getReviewState(actor, c.id)]);
  const showReview = c.versions.length > 0 || review.history.length > 0;
  const myTasks = c.tasks.filter((t) => t.isMine);
  const productionOpen = PRODUCTION_STATUSES.includes(c.status);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/work/content"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Content
      </Link>

      <header>
        <p className="text-xs text-muted-foreground">
          {c.brand.name} · {contentTypeLabel(c.contentType)} · <ContentCode code={c.code} />
        </p>
        <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight text-balance">
          {c.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <ContentStatusBadge status={c.status} />
          <PriorityMark priority={c.priority} />
          {c.dueDate && (
            <span className="text-muted-foreground">
              Due <DueDate iso={c.dueDate} timeZone={timezone} today={todayInTimeZone(timezone)} />
            </span>
          )}
        </div>
        {c.canEditIdea && (
          <div className="mt-3">
            <EditContentButton
              full={false}
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
          </div>
        )}
      </header>

      {c.createdByMe &&
        c.status === "PROPOSED" &&
        c.ideaReview?.decision === "CHANGES_REQUESTED" && (
          <IdeaChangesBanner contentId={c.id} note={c.ideaReview.note} canResubmit />
        )}
      {c.createdByMe && c.status === "PROPOSED" && !c.ideaReview && (
        <p className="rounded-xl border bg-subtle px-4 py-3 text-sm text-muted-foreground">
          Your idea is waiting for a manager&apos;s review. You can still edit it.
        </p>
      )}
      {c.createdByMe && c.status === "REJECTED" && (
        <p className="rounded-xl border bg-tone-danger-bg/50 px-4 py-3 text-sm">
          <span className="font-medium">Not taken forward.</span> {c.ideaReview?.note}
        </p>
      )}

      {showReview && (
        <Section title="Review">
          <ReviewPanel state={review} versions={c.versions} timeZone={timezone} />
        </Section>
      )}

      {myTasks.length > 0 && (
        <Section title="Your tasks">
          <TaskPanel
            contentId={c.id}
            route={c.route}
            tasks={myTasks}
            manage={false}
            productionOpen={productionOpen}
          />
        </Section>
      )}

      <Section title={c.origin === "TEAM_IDEA" ? "Idea" : "Brief"}>
        <div className="px-4 py-4">
          {c.description ? (
            <p className="text-sm text-pretty whitespace-pre-line">{c.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {c.origin === "TEAM_IDEA" ? "No description yet." : "No brief written."}
            </p>
          )}
          {c.notes && (
            <div className="mt-3 rounded-md bg-subtle px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">Team notes</p>
              <p className="mt-0.5 text-sm text-pretty whitespace-pre-line">{c.notes}</p>
            </div>
          )}
        </div>
      </Section>

      {c.references.length > 0 && (
        <Section title={`References · ${c.references.length}`}>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {c.references.map((r) => (
              <ReferenceCard key={r.id} reference={r} />
            ))}
          </div>
        </Section>
      )}

      {c.tasks.length > 0 && (
        <Section title="Production">
          <TaskPanel
            contentId={c.id}
            route={c.route}
            tasks={c.tasks}
            manage={false}
            productionOpen={productionOpen}
          />
        </Section>
      )}

      {(c.versions.length > 0 || c.canAddVersion) && (
        <Section
          title={`Versions${c.versions.length ? ` · ${c.versions.length}` : ""}`}
          action={
            c.canAddVersion ? (
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
      )}

      {review.history.length > 0 && (
        <Section title={`Approval history · ${review.history.length}`}>
          <ApprovalHistoryList items={review.history} timeZone={timezone} />
        </Section>
      )}
    </div>
  );
}
