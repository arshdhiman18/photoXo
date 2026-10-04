import Link from "next/link";
import { TaskStatusControl } from "@/features/content/components/task-panel";
import { contentTypeLabel, DueDate } from "@/features/content/components/content-bits";
import type { MyTaskDTO } from "@/features/content/types";
import { TASK_TYPE_DEFS } from "@/lib/domain/content";

/** One of "my" tasks: what, for which brand/content, when — and the next status move. */
export function MyTaskCard({
  task,
  timeZone,
  today,
}: {
  task: MyTaskDTO;
  timeZone: string;
  today?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3.5 shadow-xs sm:flex-row sm:items-center">
      <Link href={`/work/content/${task.content.id}`} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="mt-0.5 truncate text-sm">{task.content.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {task.brand.name} · {contentTypeLabel(task.content.contentType)} ·{" "}
          {TASK_TYPE_DEFS[task.taskType].label}
          {task.dueDate && (
            <>
              {" · due "}
              <DueDate iso={task.dueDate} timeZone={timeZone} today={today} className="text-xs" />
            </>
          )}
        </p>
      </Link>
      <div className="flex shrink-0 justify-end">
        <TaskStatusControl task={task} />
      </div>
    </div>
  );
}
