import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { NativeSelect } from "@/components/common/native-select";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ContentCode, TaskStatusBadge } from "@/features/content/components/content-bits";
import { taskBoardQuerySchema, type TaskBoardQuery } from "@/features/content/schemas";
import type { AdminTaskDTO } from "@/features/content/types";
import { TASK_TYPE_DEFS } from "@/lib/domain/content";
import { Workspace } from "@/lib/domain/roles";
import { formatCalendarDate, formatDate, todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageTasks } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listBrandOptions } from "@/server/services/brands.service";
import { listTasksAdmin } from "@/server/services/tasks.service";
import { listCrewPeople } from "@/server/services/users.service";

export const metadata: Metadata = { title: "Tasks" };

const VIEWS: { key: TaskBoardQuery["view"]; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "unassigned", label: "Unassigned" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];

/** Supervisor overview: who has which task, and whether they've started or finished it. */
export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageTasks(actor)) return <AccessDenied backHref="/admin" />;
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" && raw[k] ? raw[k] : undefined);
  const q = taskBoardQuerySchema.parse({ view: one("view"), assignee: one("assignee"), brand: one("brand") });
  const [board, people, brands, agency] = await Promise.all([
    listTasksAdmin(actor, q),
    listCrewPeople(actor),
    listBrandOptions(actor),
    getAgencyContext(actor),
  ]);
  const tz = agency.timezone;
  const today = todayInTimeZone(tz);
  const href = (view: string) => {
    const p = new URLSearchParams({ view });
    if (q.assignee) p.set("assignee", q.assignee);
    if (q.brand) p.set("brand", q.brand);
    return `/admin/tasks?${p}`;
  };
  const count: Partial<Record<TaskBoardQuery["view"], number>> = {
    open: board.counts.open,
    in_progress: board.counts.inProgress,
    blocked: board.counts.blocked,
    unassigned: board.counts.unassigned,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tasks"
        description="Who is working on what. Team members start and complete their own tasks; you assign and unblock."
      />

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Open", board.counts.open, "open"],
          ["In progress", board.counts.inProgress, "in_progress"],
          ["Unassigned", board.counts.unassigned, "unassigned"],
          ["Done in 7 days", board.counts.doneThisWeek, "done"],
        ].map(([label, n, view]) => (
          <li key={String(view)}>
            <Link href={href(String(view))} className="flex h-full flex-col rounded-xl border bg-card px-3 py-3 shadow-xs hover:bg-subtle">
              <span className="text-xl font-semibold tabular-nums">{n}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <nav aria-label="Task status" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href(v.key)}
              aria-current={q.view === v.key ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground",
                q.view === v.key && "bg-card font-medium text-foreground shadow-sm",
              )}
            >
              {v.label}
              {count[v.key] !== undefined && <span className="text-xs tabular-nums">{count[v.key]}</span>}
            </Link>
          ))}
        </div>
      </nav>

      <form action="/admin/tasks" method="get" className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 shadow-xs sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="view" value={q.view} />
        <div className="grid gap-1">
          <Label htmlFor="tf-assignee" className="text-xs text-muted-foreground">Team member</Label>
          <NativeSelect id="tf-assignee" name="assignee" defaultValue={q.assignee ?? ""}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tf-brand" className="text-xs text-muted-foreground">Brand</Label>
          <NativeSelect id="tf-brand" name="brand" defaultValue={q.brand ?? ""}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Button asChild variant="ghost">
            <Link href={`/admin/tasks?view=${q.view}`}>Reset</Link>
          </Button>
        </div>
      </form>

      {board.items.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks here" description="Tasks are created from each content item's production route." />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs lg:block">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Tasks</caption>
              <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Task · content</th>
                  <th scope="col" className="w-36 px-3 py-2 font-medium">Assigned to</th>
                  <th scope="col" className="w-36 px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="hidden w-32 px-3 py-2 font-medium xl:table-cell">Started</th>
                  <th scope="col" className="w-32 px-3 py-2 font-medium">Completed / due</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {board.items.map((t) => (
                  <tr key={t.id} className="align-top hover:bg-subtle">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/content/${t.content.id}`} className="block truncate font-medium hover:underline">
                        {t.title || TASK_TYPE_DEFS[t.taskType].label}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        <ContentCode code={t.content.code} /> {t.content.title} · {t.brand.name}
                      </span>
                    </td>
                    <td className="truncate px-3 py-2.5">
                      {t.assignee ? t.assignee.name : <span className="text-tone-warning">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <TaskStatusBadge status={t.status} />
                      {t.waitingOnShoot && <span className="mt-1 block text-xs text-muted-foreground">Waiting for shoot</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-muted-foreground xl:table-cell">
                      {t.startedAt ? formatDate(t.startedAt, tz, { hour: "numeric", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <When task={t} tz={tz} today={today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid grid-cols-1 gap-2 lg:hidden">
            {board.items.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/content/${t.content.id}`} className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 shadow-xs hover:bg-subtle">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{t.title || TASK_TYPE_DEFS[t.taskType].label}</span>
                      <span className="block truncate text-sm text-muted-foreground">{t.content.title} · {t.brand.name}</span>
                    </span>
                    <TaskStatusBadge status={t.status} />
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{t.assignee ? t.assignee.name : <span className="text-tone-warning">Unassigned</span>}</span>
                    {t.waitingOnShoot && <span>Waiting for shoot</span>}
                    <When task={t} tz={tz} today={today} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {board.truncated && (
            <p className="text-xs text-muted-foreground">Showing the first 300 tasks. Filter by team member or brand to narrow it down.</p>
          )}
        </>
      )}
    </div>
  );
}

function When({ task, tz, today }: { task: AdminTaskDTO; tz: string; today: string }) {
  if (task.completedAt) {
    return <span className="text-tone-success">Done {formatDate(task.completedAt, tz, { hour: "numeric", minute: "2-digit" })}</span>;
  }
  if (!task.dueDate) return <span className="text-muted-foreground">No due date</span>;
  const due = task.dueDate.slice(0, 10);
  return (
    <span className={cn(due < today ? "text-tone-danger" : "text-muted-foreground")}>
      {due < today ? "Overdue · " : "Due "}
      {formatCalendarDate(due)}
    </span>
  );
}
