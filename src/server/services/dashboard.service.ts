import "server-only";
import { ContentStatus, OPEN_TASK_STATUSES } from "@/lib/domain/content";
import { ExpenseStatus } from "@/lib/domain/expenses";
import { addDays, todayInTimeZone } from "@/lib/dates";
import type { Actor } from "@/server/authz/actor";
import { assertCan, canManageProduction, canViewAllExpenses } from "@/server/authz/permissions";
import { contentRepo, tasksRepo } from "@/server/repositories/content.repo";
import { expenseTotals } from "@/server/repositories/expenses.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { shootRepo } from "@/server/repositories/shoots.repo";
import { getAgencyContext } from "./agency.service";
import { listReadyToPost } from "./postings.service";
import { listShootsForAdmin } from "./shoots.service";

/**
 * Operational summary for ADMIN/MANAGER — counts and links only. The
 * dashboard points into the existing pages (which remain the source of
 * truth); it is not an analytics module.
 */
export async function getOperationsSummary(actor: Actor) {
  assertCan(canManageProduction(actor));
  const { timezone, currency } = await getAgencyContext(actor);
  const today = todayInTimeZone(timezone);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const live = { archivedAt: null };
  const count = (status: ContentStatus) => contentRepo.count(actor, { ...live, status });

  const [
    ideas,
    planned,
    inProduction,
    internalReview,
    clientReview,
    changes,
    readyToPost,
    postedWeek,
    completed,
    archived,
    overdueContent,
    overdueTasks,
    ready,
    shootsToday,
    shootsOpen,
    expenses,
  ] = await Promise.all([
    count(ContentStatus.PROPOSED),
    count(ContentStatus.PLANNED),
    count(ContentStatus.IN_PRODUCTION),
    count(ContentStatus.INTERNAL_REVIEW),
    count(ContentStatus.CLIENT_REVIEW),
    count(ContentStatus.CHANGES_REQUESTED),
    count(ContentStatus.READY_TO_POST),
    contentRepo.count(actor, { ...live, status: { $in: [ContentStatus.POSTED, ContentStatus.COMPLETED] }, completedAt: { $gte: weekAgo } }),
    count(ContentStatus.COMPLETED),
    contentRepo.count(actor, { archivedAt: { $ne: null } }),
    contentRepo.count(actor, {
      ...live,
      dueDate: { $ne: null, $lt: now },
      status: { $in: [ContentStatus.PLANNED, ContentStatus.IN_PRODUCTION, ContentStatus.INTERNAL_REVIEW, ContentStatus.CLIENT_REVIEW, ContentStatus.CHANGES_REQUESTED] },
    }),
    tasksRepo.count(actor, { status: { $in: OPEN_TASK_STATUSES }, dueDate: { $ne: null, $lt: now } }),
    listReadyToPost(actor),
    listShootsForAdmin(actor, { date: today }),
    shootRepo.count(actor, { status: { $in: ["IN_PROGRESS", "PARTIALLY_COMPLETED"] } }),
    canViewAllExpenses(actor)
      ? expenseTotals({ agencyId: asObjectId(actor.agencyId), status: ExpenseStatus.SUBMITTED })
      : Promise.resolve({ count: 0, totalMinor: 0, byStatus: {} }),
  ]);
  const uploaderProblems = ready.filter((i) => !i.uploader.valid || i.targetPlatforms.length === 0).length;
  const overdueShoots = await shootRepo.count(actor, {
    status: { $in: ["SCHEDULED", "IN_PROGRESS", "PARTIALLY_COMPLETED"] },
    date: { $lt: today },
  });

  return {
    today,
    weekEnd: addDays(today, 6),
    currency,
    attention: [
      { key: "internal", label: "Waiting for internal review", count: internalReview, href: "/admin/approvals" },
      { key: "changes", label: "Changes requested", count: changes, href: "/admin/approvals?tab=changes" },
      { key: "uploader", label: "Posting problems (uploader / platforms)", count: uploaderProblems, href: "/admin/ready-to-post?tab=attention", danger: true },
      { key: "overdue", label: "Overdue content", count: overdueContent, href: "/admin/content?due=overdue", danger: true },
      { key: "tasks", label: "Overdue tasks", count: overdueTasks, href: "/admin/content?due=overdue" },
      { key: "shoots", label: "Shoots not marked complete", count: overdueShoots, href: "/admin/shoots?when=past", danger: true },
      { key: "ideas", label: "Ideas to review", count: ideas, href: "/admin/content?status=PROPOSED" },
      { key: "expenses", label: "Expenses to approve", count: expenses.count, href: "/admin/expenses?status=SUBMITTED", amountMinor: expenses.totalMinor },
    ],
    pipeline: [
      { label: "Planned", count: planned, href: "/admin/content?status=PLANNED" },
      { label: "In production", count: inProduction, href: "/admin/content?status=IN_PRODUCTION" },
      { label: "Internal review", count: internalReview, href: "/admin/approvals" },
      { label: "With client", count: clientReview, href: "/admin/approvals?tab=client" },
      { label: "Ready to post", count: readyToPost, href: "/admin/ready-to-post" },
      { label: "Completed", count: completed, href: "/admin/content?status=COMPLETED" },
      { label: "Archived", count: archived, href: "/admin/content?archived=1" },
    ],
    postedThisWeek: postedWeek,
    shootsToday: shootsToday.items,
    shootsInProgress: shootsOpen,
  };
}
