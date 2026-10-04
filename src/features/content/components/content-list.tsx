import Link from "next/link";
import { ChevronRight, Clapperboard, SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ContentCode,
  ContentStatusBadge,
  contentTypeLabel,
  DueDate,
  originLabel,
  PriorityMark,
  TaskProgress,
} from "@/features/content/components/content-bits";
import { NewBriefButton } from "@/features/content/components/brief-form-dialog";
import type { ContentListQuery } from "@/features/content/schemas";
import type { ContentListData } from "@/features/content/types";
import { formatDate } from "@/lib/dates";

export function ContentList({
  data,
  query,
  timeZone,
  brands,
  today,
}: {
  today: string;
  data: ContentListData;
  query: ContentListQuery;
  timeZone: string;
  brands: { id: string; name: string }[];
}) {
  const filtered = Object.entries(query).some(([k, v]) => k !== "page" && v);
  if (data.items.length === 0) {
    return filtered ? (
      <EmptyState
        icon={SearchX}
        title="No content matches these filters"
        description="Try a different search or clear the filters."
        action={
          <Button asChild variant="outline">
            <Link href="/admin/content">Clear filters</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={Clapperboard}
        title="No content yet"
        description="Create a brief, or wait for your team's ideas to come in."
        action={<NewBriefButton brands={brands} variant="outline" />}
      />
    );
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v && k !== "page") p.set(k, String(v));
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `/admin/content?${s}` : "/admin/content";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[36%] pl-4">Content</TableHead>
              <TableHead className="w-[15%]">Brand</TableHead>
              <TableHead className="w-[16%]">Status</TableHead>
              <TableHead className="w-[17%]">Tasks</TableHead>
              <TableHead className="w-[8%]">Due</TableHead>
              <TableHead className="hidden w-[10%] xl:table-cell">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((c) => (
              <TableRow key={c.id} className="relative">
                <TableCell className="py-2.5 pl-4">
                  <Link
                    href={`/admin/content/${c.id}`}
                    className="block min-w-0 outline-none after:absolute after:inset-0 focus-visible:underline"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.title}</span>
                      <PriorityMark priority={c.priority} />
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <ContentCode code={c.code} /> · {contentTypeLabel(c.contentType)} ·{" "}
                      {originLabel(c.origin)}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="truncate text-sm">{c.brand.name}</TableCell>
                <TableCell>
                  <ContentStatusBadge status={c.status} />
                </TableCell>
                <TableCell>
                  <TaskProgress {...c.tasks} />
                </TableCell>
                <TableCell>
                  <DueDate iso={c.dueDate} timeZone={timeZone} today={today} />
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                  {formatDate(c.updatedAt, timeZone, { year: undefined })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-2 md:hidden">
        {data.items.map((c) => (
          <li key={c.id}>
            <Link
              href={`/admin/content/${c.id}`}
              className="flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-xs active:bg-subtle"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{c.title}</span>
                  <PriorityMark priority={c.priority} />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {c.brand.name} · {contentTypeLabel(c.contentType)} · <ContentCode code={c.code} />
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <ContentStatusBadge status={c.status} />
                  <TaskProgress {...c.tasks} />
                  {c.dueDate && (
                    <span className="text-xs text-muted-foreground">
                      Due{" "}
                      <DueDate
                        iso={c.dueDate}
                        timeZone={timeZone}
                        today={today}
                        className="text-xs"
                      />
                    </span>
                  )}
                </span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground tabular-nums">
            Page {data.page} of {pages} · {data.total} items
          </p>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className={data.page <= 1 ? "pointer-events-none opacity-50" : undefined}
            >
              <Link href={href(data.page - 1)}>Previous</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className={data.page >= pages ? "pointer-events-none opacity-50" : undefined}
            >
              <Link href={href(data.page + 1)}>Next</Link>
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
