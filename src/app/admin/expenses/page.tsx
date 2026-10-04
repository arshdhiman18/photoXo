import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { ExpenseList, ExpenseTotals } from "@/features/expenses/components/expense-bits";
import { ExpenseFiltersForm } from "@/features/expenses/components/expense-filters";
import { expenseFiltersSchema } from "@/features/expenses/schemas";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canViewAllExpenses } from "@/server/authz/permissions";
import { getExpenseFilterOptions, listExpensesAdmin } from "@/server/services/expenses.service";

export const metadata: Metadata = { title: "Expenses" };

export default async function AdminExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canViewAllExpenses(actor)) return <AccessDenied backHref="/admin" />;
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" && raw[k] ? raw[k] : undefined);
  const f = expenseFiltersSchema.parse(Object.fromEntries(["from", "to", "employee", "brand", "shoot", "category", "status", "page"].map((k) => [k, one(k)])));
  const [data, opts] = await Promise.all([listExpensesAdmin(actor, f), getExpenseFilterOptions(actor)]);
  const next = new URLSearchParams(Object.entries({ ...f, page: String(data.page + 1) }).filter((e): e is [string, string] => typeof e[1] === "string"));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Expenses"
        description="Approve team expenses. Totals reflect the filters."
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/expenses?status=SUBMITTED">Awaiting approval · {data.totals.submitted.count}</Link>
          </Button>
        }
      />
      <ExpenseFiltersForm action="/admin/expenses" f={f} people={opts.people} brands={opts.brands} shoots={opts.shoots} />
      <ExpenseTotals totals={data.totals} currency={data.currency} />
      <ExpenseList items={data.items} hrefBase="/admin/expenses" showEmployee />
      {data.hasMore && (
        <Button asChild variant="outline" className="self-center">
          <Link href={`/admin/expenses?${next}`}>More</Link>
        </Button>
      )}
    </div>
  );
}
