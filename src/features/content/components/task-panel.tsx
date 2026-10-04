"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignTaskAction,
  createTaskAction,
  searchAssigneesAction,
  updateTaskStatusAction,
} from "@/features/content/actions";
import { ToneBadge } from "@/components/common/tone-badge";
import { TaskStatusBadge } from "@/features/content/components/content-bits";
import type { AssigneeCandidateDTO, TaskDTO } from "@/features/content/types";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";
import {
  PRODUCTION_ROUTE_DEFS,
  TASK_STATUS_LABEL,
  TASK_TYPE_DEFS,
  TASK_TYPES,
  type ProductionRoute,
  type TaskStatus,
  type TaskType,
} from "@/lib/domain/content";
import type { BrandRole } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

/** Status control: shows only the moves the server says this viewer may make. */
export function TaskStatusControl({
  task,
}: {
  task: Pick<TaskDTO, "id" | "status" | "allowedStatuses"> & { waitingOnShoot?: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (task.allowedStatuses.length === 0) {
    return task.waitingOnShoot ? (
      <ToneBadge tone="neutral">
        Waiting on shoot
      </ToneBadge>
    ) : (
      <TaskStatusBadge status={task.status} />
    );
  }
  return (
    <Select
      value={task.status}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const res = await updateTaskStatusAction({ taskId: task.id, status: v as TaskStatus });
          if (!res.ok) return void toast.error(res.error.message);
          toast.success(`Marked ${TASK_STATUS_LABEL[v as TaskStatus].toLowerCase()}`);
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="h-8 w-[8.5rem]" aria-label="Task status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={task.status}>{TASK_STATUS_LABEL[task.status]}</SelectItem>
        {task.allowedStatuses.map((s) => (
          <SelectItem key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Route stepper + tasks. `manage` enables assignment and adding tasks (server re-checks). */
export function TaskPanel({
  contentId,
  route,
  tasks,
  manage,
  productionOpen,
}: {
  contentId: string;
  route: ProductionRoute;
  tasks: TaskDTO[];
  manage: boolean;
  productionOpen: boolean;
}) {
  const [assigning, setAssigning] = useState<TaskDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const steps = PRODUCTION_ROUTE_DEFS[route].steps;
  const open = tasks.filter((t) => t.status !== "CANCELLED");

  return (
    <div className="flex flex-col">
      <ol
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b px-4 py-3 text-xs sm:px-5"
        aria-label="Production route"
      >
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-6 items-center rounded-md border px-2",
                s.kind === "SHOOT" && "border-dashed text-muted-foreground",
                s.kind === "REVIEW" && "bg-subtle text-muted-foreground",
              )}
              title={
                s.kind === "SHOOT" ? "Scheduled as a Shoot (coming in the next stage)" : undefined
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
          </li>
        ))}
      </ol>

      {open.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
          {productionOpen ? "No tasks yet." : "Tasks are created when the content is planned."}
        </p>
      ) : (
        <ul className="divide-y">
          {open.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{t.title}</span>
                  {t.isMine && (
                    <span className="shrink-0 text-xs font-normal text-tone-info">Yours</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {TASK_TYPE_DEFS[t.taskType].label}
                  {t.source === "MANUAL" && " · added"}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                {t.assignee ? (
                  <button
                    type="button"
                    disabled={!manage || !productionOpen || t.status === "COMPLETED"}
                    onClick={() => setAssigning(t)}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm enabled:hover:bg-subtle"
                  >
                    <UserAvatar
                      name={t.assignee.name}
                      image={t.assignee.image}
                      seed={t.assignee.id}
                      className="size-6"
                    />
                    <span className="max-w-[9rem] truncate">{t.assignee.name}</span>
                  </button>
                ) : manage && productionOpen ? (
                  <Button variant="outline" size="sm" onClick={() => setAssigning(t)}>
                    <UserPlus data-icon="inline-start" />
                    Assign
                  </Button>
                ) : (
                  <span className="text-sm text-tone-warning">Unassigned</span>
                )}
                <TaskStatusControl task={t} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {manage && productionOpen && (
        <div className="border-t px-4 py-2.5 sm:px-5">
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            Add task
          </Button>
        </div>
      )}

      {assigning && (
        <AssignDialog
          open
          onOpenChange={(o) => !o && setAssigning(null)}
          contentId={contentId}
          taskType={assigning.taskType}
          title={`Assign “${assigning.title}”`}
          current={assigning.assignee?.id ?? null}
          onPick={async (userId) => {
            const res = await assignTaskAction({ taskId: assigning.id, assignedTo: userId });
            if (!res.ok) return res.error.message;
            return null;
          }}
        />
      )}
      {adding && <AddTaskDialog open onOpenChange={setAdding} contentId={contentId} />}
    </div>
  );
}

function useCandidates(contentId: string, taskType: TaskType, q: string) {
  const [results, setResults] = useState<AssigneeCandidateDTO[] | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(
      () =>
        start(async () => {
          const res = await searchAssigneesAction({ contentId, taskType, q: q.trim() });
          setResults(res.ok ? res.data : []);
        }),
      200,
    );
    return () => clearTimeout(t);
  }, [contentId, taskType, q]);
  return { results, pending };
}

function CandidatePicker({
  contentId,
  taskType,
  selected,
  onSelect,
}: {
  contentId: string;
  taskType: TaskType;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const { results, pending } = useCandidates(contentId, taskType, q);
  const roles = TASK_TYPE_DEFS[taskType].eligibleBrandRoles
    .map((r) => BRAND_ROLE_LABEL[r])
    .join(", ");
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          className="pr-8 pl-8"
        />
        {pending && (
          <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      <div
        className="max-h-60 overflow-y-auto rounded-lg border"
        role="listbox"
        aria-label="Eligible people"
      >
        {results === null ? (
          <p className="px-3 py-5 text-center text-sm text-muted-foreground">Loading…</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-5 text-center text-sm text-pretty text-muted-foreground">
            No eligible people. Assign brand roles ({roles}) on the brand&apos;s Team tab first.
          </p>
        ) : (
          <ul className="divide-y">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === c.id}
                  onClick={() => onSelect(selected === c.id ? null : c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle [@media(pointer:coarse)]:py-3",
                    selected === c.id && "bg-accent",
                  )}
                >
                  <UserAvatar name={c.name} image={c.image} seed={c.id} className="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.brandRoles.map((r) => BRAND_ROLE_LABEL[r as BrandRole]).join(", ")}
                    </span>
                  </span>
                  {selected === c.id && <Check className="size-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Only active members of this brand with a qualifying role are listed.
      </p>
    </div>
  );
}

function AssignDialog({
  open,
  onOpenChange,
  contentId,
  taskType,
  title,
  current,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contentId: string;
  taskType: TaskType;
  title: string;
  current: string | null;
  onPick: (userId: string | null) => Promise<string | null>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(current);
  const [pending, start] = useTransition();
  const save = (userId: string | null) =>
    start(async () => {
      const err = await onPick(userId);
      if (err) return void toast.error(err);
      toast.success(userId ? "Task assigned" : "Task unassigned");
      onOpenChange(false);
      router.refresh();
    });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex flex-col gap-4">
        <CandidatePicker
          contentId={contentId}
          taskType={taskType}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {current ? (
            <Button variant="ghost" onClick={() => save(null)} disabled={pending}>
              Unassign
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save(selected)}
              disabled={pending || !selected || selected === current}
            >
              {pending ? "Saving…" : "Assign"}
            </Button>
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function AddTaskDialog({
  open,
  onOpenChange,
  contentId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contentId: string;
}) {
  const router = useRouter();
  const [taskType, setTaskType] = useState<TaskType>("OTHER");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Add a task">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Task type</Label>
            <Select
              value={taskType}
              onValueChange={(v) => {
                setTaskType(v as TaskType);
                setAssignee(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TASK_TYPE_DEFS[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="task-due">
              Due <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-title">
            Title <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={TASK_TYPE_DEFS[taskType].label}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>
            Assignee <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <CandidatePicker
            contentId={contentId}
            taskType={taskType}
            selected={assignee}
            onSelect={setAssignee}
          />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await createTaskAction({
                  contentId,
                  taskType,
                  title,
                  assignedTo: assignee,
                  dueDate: due,
                });
                if (!res.ok) return void toast.error(res.error.message);
                toast.success("Task added");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {pending ? "Adding…" : "Add task"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
