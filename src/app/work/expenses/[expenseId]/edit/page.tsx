import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getAgencyContext } from "@/server/services/agency.service";
import { getExpense, getExpenseFormOptions } from "@/server/services/expenses.service";
import { mediaEnabled } from "@/server/services/media.service";

export const metadata: Metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ expenseId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { expenseId } = await params;
  let e;
  try {
    e = await getExpense(actor, expenseId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (!e.isMine) notFound();
  if (!e.canEdit) redirect(`/work/expenses/${e.id}`);
  const [options, agency] = await Promise.all([getExpenseFormOptions(actor), getAgencyContext(actor)]);
  return (
    <div className="flex flex-col gap-5">
      <Link href={`/work/expenses/${e.id}`} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <PageHeader title="Edit expense" description={e.status === "REJECTED" ? "Fix it, then resubmit from the expense page." : undefined} />
      <ExpenseForm options={options} today={todayInTimeZone(agency.timezone)} mediaEnabled={mediaEnabled()} expense={e} backHref="/work/expenses" />
    </div>
  );
}
