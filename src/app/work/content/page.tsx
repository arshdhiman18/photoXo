import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Clapperboard, Lightbulb, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { AddIdeaButton } from "@/features/content/components/brief-form-dialog";
import {
  ContentCode,
  ContentStatusBadge,
  contentTypeLabel,
  PriorityMark,
} from "@/features/content/components/content-bits";
import { Workspace } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canProposeIdeas } from "@/server/authz/permissions";
import { listMyBrands } from "@/server/services/brands.service";
import { listContentForStaff, type StaffContentView } from "@/server/services/content.service";

export const metadata: Metadata = { title: "Content" };

const TABS: { view: StaffContentView; label: string }[] = [
  { view: "assigned", label: "Assigned to me" },
  { view: "ideas", label: "My ideas" },
  { view: "brands", label: "My brands' content" },
];

const EMPTY = {
  assigned: {
    icon: ListChecks,
    title: "Nothing assigned to you",
    body: "Content with tasks assigned to you appears here.",
  },
  ideas: {
    icon: Lightbulb,
    title: "No ideas yet",
    body: "Have an idea for one of your brands? Add it — no reference needed.",
  },
  brands: {
    icon: Clapperboard,
    title: "No content for your brands yet",
    body: "Planned content for brands you're on appears here.",
  },
};

export default async function StaffContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const raw = (await searchParams).view;
  const view: StaffContentView = raw === "ideas" || raw === "brands" ? raw : "assigned";
  const [items, brands] = await Promise.all([
    listContentForStaff(actor, view),
    listMyBrands(actor),
  ]);
  const internalBrands = brands
    .filter((b) => b.myRoles.some((r) => r !== "CLIENT"))
    .map((b) => ({ id: b.id, name: b.name }));
  const empty = EMPTY[view];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Content"
        description="Your work and your ideas."
        actions={canProposeIdeas(actor) ? <AddIdeaButton brands={internalBrands} /> : undefined}
      />

      <nav
        aria-label="Content views"
        className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <ul className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <li key={t.view}>
              <Link
                href={t.view === "assigned" ? "/work/content" : `/work/content?view=${t.view}`}
                aria-current={view === t.view ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground",
                  view === t.view && "bg-card font-medium text-foreground shadow-sm",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.body}
          action={
            view === "ideas" && internalBrands.length > 0 ? (
              <AddIdeaButton brands={internalBrands} />
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/work/content/${c.id}`}
                className="flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-xs hover:bg-subtle"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    <PriorityMark priority={c.priority} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {c.brand.name} · {contentTypeLabel(c.contentType)} ·{" "}
                    <ContentCode code={c.code} />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <ContentStatusBadge status={c.status} />
                    {c.myOpenTasks > 0 && (
                      <span className="text-xs text-tone-info">
                        {c.myOpenTasks} task{c.myOpenTasks === 1 ? "" : "s"} for you
                      </span>
                    )}
                    {c.ideaDecision === "CHANGES_REQUESTED" && c.status === "PROPOSED" && (
                      <span className="text-xs text-tone-warning">Changes requested</span>
                    )}
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
