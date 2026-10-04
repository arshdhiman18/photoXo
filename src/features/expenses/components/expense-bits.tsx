import Link from "next/link";
import { ChevronRight, ExternalLink, Receipt } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ToneBadge } from "@/components/common/tone-badge";
import type { ExpenseDTO, ExpenseTotalsDTO } from "@/features/expenses/types";
import { EXPENSE_STATUS_LABEL, EXPENSE_STATUS_TONE, expenseCategoryLabel, type ExpenseStatus } from "@/lib/domain/expenses";
import { formatCalendarDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <ToneBadge tone={EXPENSE_STATUS_TONE[status]}>{EXPENSE_STATUS_LABEL[status]}</ToneBadge>;
}

export function ReceiptLink({ receipt }: { receipt: ExpenseDTO["receipt"] }) {
  if (!receipt) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tone-info hover:underline">
      Receipt
      <ExternalLink className="size-3.5" />
    </a>
  );
}

/** Totals for the current (filtered) set — integer sums formatted at the edge. */
export function ExpenseTotals({ totals, currency }: { totals: ExpenseTotalsDTO; currency: string }) {
  const cells: [string, { count: number; totalMinor: number }][] = [
    ["Awaiting approval", totals.submitted],
    ["Approved", totals.approved],
    ["Rejected", totals.rejected],
    ["All in view", { count: totals.count, totalMinor: totals.totalMinor }],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cells.map(([label, v]) => (
        <div key={label} className="min-w-0 rounded-xl border bg-card px-4 py-3 shadow-xs">
          <dt className="truncate text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 truncate text-base font-semibold tabular-nums">{formatMoney(v.totalMinor, currency)}</dd>
          <dd className="text-xs text-muted-foreground tabular-nums">
            {v.count} {v.count === 1 ? "expense" : "expenses"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Expense list: a dense table on desktop (Date · Employee · Brand · Shoot ·
 * Category · Title · Amount · Receipt · Status), stacked cards below lg.
 */
export function ExpenseList({ items, hrefBase, showEmployee, emptyAction }: { items: ExpenseDTO[]; hrefBase: string; showEmployee?: boolean; emptyAction?: React.ReactNode }) {
  if (items.length === 0) {
    return <EmptyState icon={Receipt} title="No expenses" description="Expenses matching this view will appear here." action={emptyAction} />;
  }
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs lg:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Expenses</caption>
          <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-24 px-3 py-2 font-medium">Date</th>
              {showEmployee && <th scope="col" className="w-32 px-3 py-2 font-medium">Employee</th>}
              <th scope="col" className="px-3 py-2 font-medium">Title</th>
              <th scope="col" className="w-40 px-3 py-2 font-medium">Brand · shoot</th>
              <th scope="col" className="hidden w-28 px-3 py-2 font-medium xl:table-cell">Category</th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">Amount</th>
              <th scope="col" className="hidden w-24 px-3 py-2 font-medium xl:table-cell">Receipt</th>
              <th scope="col" className="w-40 px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((e) => (
              <tr key={e.id} className="hover:bg-subtle">
                <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatCalendarDate(e.incurredOn, { weekday: undefined })}</td>
                {showEmployee && <td className="truncate px-3 py-2.5">{e.employee?.name ?? "—"}</td>}
                <td className="px-3 py-2.5">
                  <Link href={`${hrefBase}/${e.id}`} className="block truncate font-medium hover:underline">
                    {e.title}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground xl:hidden">{expenseCategoryLabel(e.category)}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="block truncate">{e.brand?.name ?? <span className="text-muted-foreground">—</span>}</span>
                  {e.shoot && <span className="block truncate text-xs text-muted-foreground">{e.shoot.title}</span>}
                </td>
                <td className="hidden truncate px-3 py-2.5 xl:table-cell">{expenseCategoryLabel(e.category)}</td>
                <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">{formatMoney(e.amountMinor, e.currency)}</td>
                <td className="hidden px-3 py-2.5 xl:table-cell">
                  <ReceiptLink receipt={e.receipt} />
                </td>
                <td className="px-3 py-2.5">
                  <ExpenseStatusBadge status={e.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid grid-cols-1 gap-2 lg:hidden">
        {items.map((e) => (
          <li key={e.id}>
            <Link href={`${hrefBase}/${e.id}`} className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs hover:bg-subtle">
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-medium">{e.title}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatMoney(e.amountMinor, e.currency)}</span>
                </p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {formatCalendarDate(e.incurredOn)} · {expenseCategoryLabel(e.category)}
                  {e.brand && ` · ${e.brand.name}`}
                  {showEmployee && e.employee && ` · ${e.employee.name}`}
                </p>
                <div className="mt-2">
                  <ExpenseStatusBadge status={e.status} />
                </div>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
