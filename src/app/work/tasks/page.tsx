import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { MyTaskCard } from "@/features/content/components/my-task-card";
import type { MyTaskDTO } from "@/features/content/types";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/domain/content";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { listMyTasks } from "@/server/services/tasks.service";

export const metadata: Metadata = { title: "Tasks" };

const ORDER: TaskStatus[] = ["IN_PROGRESS", "TODO", "BLOCKED", "COMPLETED"];

export default async function MyTasksPage() {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const [tasks, agency] = await Promise.all([listMyTasks(actor), getAgencyContext(actor)]);
  const groups = ORDER.map((s) => ({
    status: s,
    items: tasks.filter((t: MyTaskDTO) => t.status === s),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My tasks"
        description="Production work assigned to you, across your brands."
      />
      {groups.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing assigned to you"
          description="When a manager assigns you a task, it shows up here with the content and brand."
        />
      ) : (
        groups.map((g) => (
          <section key={g.status} aria-labelledby={`g-${g.status}`} className="flex flex-col gap-2">
            <h2
              id={`g-${g.status}`}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {g.status === "COMPLETED" ? "Done recently" : TASK_STATUS_LABEL[g.status]} ·{" "}
              {g.items.length}
            </h2>
            <ul className="flex flex-col gap-2">
              {g.items.map((t) => (
                <li key={t.id}>
                  <MyTaskCard
                    task={t}
                    timeZone={agency.timezone}
                    today={todayInTimeZone(agency.timezone)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
