import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getAgencyContext } from "@/server/services/agency.service";
import { getExpense } from "@/server/services/expenses.service";

export const metadata: Metadata = { title: "Expense" };

export default async function MyExpensePage({ params }: { params: Promise<{ expenseId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { expenseId } = await params;
  let e;
  try {
    e = await getExpense(actor, expenseId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // The staff view is the claimant's own view — anyone else's expense lives in /admin.
  if (!e.isMine) notFound();
  const { timezone } = await getAgencyContext(actor);
  return <ExpenseDetail expense={e} backHref="/work/expenses" backLabel="My expenses" base="/work/expenses" timeZone={timezone} shootHref="/work/shoots" />;
}
