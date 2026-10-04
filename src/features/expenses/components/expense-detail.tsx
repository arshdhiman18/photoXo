import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ExpenseActions } from "@/features/expenses/components/expense-actions";
import { ExpenseStatusBadge, ReceiptLink } from "@/features/expenses/components/expense-bits";
import type { ExpenseDTO } from "@/features/expenses/types";
import { expenseCategoryLabel } from "@/lib/domain/expenses";
import { formatCalendarDate, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/** One expense with its full decision history (shared by staff and admin views). */
export function ExpenseDetail({ expense: e, backHref, backLabel, base, timeZone, shootHref }: { expense: ExpenseDTO; backHref: string; backLabel: string; base: string; timeZone: string; shootHref?: string }) {
  const rows: [string, React.ReactNode][] = [
    ["Date", formatCalendarDate(e.incurredOn, { weekday: "long" })],
    ["Category", expenseCategoryLabel(e.category)],
    ["Employee", e.employee?.name ?? "—"],
    ["Brand", e.brand?.name ?? "—"],
    ["Shoot", e.shoot ? (shootHref ? <Link href={`${shootHref}/${e.shoot.id}`} className="hover:underline">{e.shoot.title}</Link> : e.shoot.title) : "—"],
    ["Receipt", <ReceiptLink key="r" receipt={e.receipt} />],
    ["Submitted", e.submittedAt ? formatDate(e.submittedAt, timeZone, { hour: "numeric", minute: "2-digit" }) : "Not yet"],
  ];
  return (
    <div className="flex flex-col gap-5">
      <Link href={backHref} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {backLabel}
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{e.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{formatMoney(e.amountMinor, e.currency)}</span>
            <ExpenseStatusBadge status={e.status} />
          </p>
        </div>
        <ExpenseActions expense={e} editHref={`${base}/${e.id}/edit`} />
      </header>
      {e.status === "REJECTED" && e.reviews.at(-1)?.reason && (
        <p className="rounded-xl border border-tone-danger/30 bg-tone-danger-bg/60 px-4 py-3 text-sm">
          <span className="font-medium">Rejected:</span> {e.reviews.at(-1)!.reason}
          {e.isMine && <span className="block text-muted-foreground">Edit it and resubmit when it&apos;s fixed.</span>}
        </p>
      )}
      <section className="rounded-xl border bg-card shadow-xs">
        <dl className="divide-y">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:px-5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
          {e.description && (
            <div className="px-4 py-3 text-sm sm:px-5">
              <dt className="text-muted-foreground">Description</dt>
              <dd className="mt-1 text-pretty whitespace-pre-line">{e.description}</dd>
            </div>
          )}
        </dl>
      </section>
      {e.reviews.length > 0 && (
        <section aria-labelledby="ex-history" className="rounded-xl border bg-card shadow-xs">
          <h2 id="ex-history" className="border-b px-4 py-3 text-sm font-medium sm:px-5">
            Decisions
          </h2>
          <ol className="divide-y">
            {[...e.reviews].reverse().map((r, i) => (
              <li key={i} className="px-4 py-3 text-sm sm:px-5">
                <p className="font-medium">{r.decision === "APPROVED" ? "Approved" : "Rejected"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.decidedBy?.name ?? "Someone"} · {formatDate(r.decidedAt, timeZone, { hour: "numeric", minute: "2-digit" })}
                </p>
                {r.reason && <p className="mt-1 text-pretty">{r.reason}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
