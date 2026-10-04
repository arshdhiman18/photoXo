import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ExpenseList, ExpenseTotals } from "@/features/expenses/components/expense-bits";
import { ExpenseFiltersForm } from "@/features/expenses/components/expense-filters";
import { expenseFiltersSchema } from "@/features/expenses/schemas";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getExpenseFilterOptions, listExpensesAdmin } from "@/server/services/expenses.service";
import { loadAdminBrand } from "../load";

export const metadata: Metadata = { title: "Brand expenses" };

/** Expenses linked to this brand (directly or through its shoots) — groundwork for profitability. */
export default async function BrandExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const brand = await loadAdminBrand(actor, (await params).brandId);
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" && raw[k] ? raw[k] : undefined);
  const f = expenseFiltersSchema.parse({ ...Object.fromEntries(["from", "to", "employee", "shoot", "category", "status", "page"].map((k) => [k, one(k)])), brand: brand.id });
  const [data, opts] = await Promise.all([listExpensesAdmin(actor, f), getExpenseFilterOptions(actor)]);
  const base = `/admin/brands/${brand.id}/expenses`;
  return (
    <div className="flex flex-col gap-4">
      <ExpenseFiltersForm action={base} f={f} people={opts.people} brands={[]} shoots={opts.shoots.filter((s) => s.brandId === brand.id)} fixedBrand />
      <ExpenseTotals totals={data.totals} currency={data.currency} />
      <ExpenseList items={data.items} hrefBase="/admin/expenses" showEmployee />
      {data.hasMore && (
        <Button asChild variant="outline" className="self-center">
          <Link href={`${base}?page=${data.page + 1}`}>More</Link>
        </Button>
      )}
    </div>
  );
}
