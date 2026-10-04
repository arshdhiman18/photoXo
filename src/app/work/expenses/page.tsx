import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { ExpenseList, ExpenseTotals } from "@/features/expenses/components/expense-bits";
import { expenseFiltersSchema } from "@/features/expenses/schemas";
import { EXPENSE_STATUS_LABEL, EXPENSE_STATUSES } from "@/lib/domain/expenses";
import { Workspace } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { listMyExpenses } from "@/server/services/expenses.service";

export const metadata: Metadata = { title: "My expenses" };

export default async function MyExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const raw = await searchParams;
  const f = expenseFiltersSchema.parse({ status: raw.status, page: raw.page });
  const data = await listMyExpenses(actor, f);
  const tab = (s?: string) => (s ? `/work/expenses?status=${s}` : "/work/expenses");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My expenses"
        description="Costs you paid for work. Only you and approvers can see them."
        actions={
          <Button asChild>
            <Link href="/work/expenses/new">
              <Plus data-icon="inline-start" />
              Add expense
            </Link>
          </Button>
        }
      />
      <ExpenseTotals totals={data.totals} currency={data.currency} />
      <nav aria-label="Status" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {[undefined, ...EXPENSE_STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={tab(s)}
              aria-current={f.status === s ? "page" : undefined}
              className={cn("inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap text-muted-foreground", f.status === s && "bg-card font-medium text-foreground shadow-sm")}
            >
              {s ? EXPENSE_STATUS_LABEL[s] : "All"}
            </Link>
          ))}
        </div>
      </nav>
      <ExpenseList
        items={data.items}
        hrefBase="/work/expenses"
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/work/expenses/new">Add expense</Link>
          </Button>
        }
      />
      {data.hasMore && (
        <Button asChild variant="outline" className="self-center">
          <Link href={`/work/expenses?${new URLSearchParams({ ...(f.status ? { status: f.status } : {}), page: String(data.page + 1) })}`}>Older</Link>
        </Button>
      )}
    </div>
  );
}
