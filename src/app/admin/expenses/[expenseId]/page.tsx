import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/common/access-denied";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { canViewAllExpenses } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { getExpense } from "@/server/services/expenses.service";

export const metadata: Metadata = { title: "Expense" };

export default async function AdminExpensePage({ params }: { params: Promise<{ expenseId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canViewAllExpenses(actor)) return <AccessDenied backHref="/admin" />;
  const { expenseId } = await params;
  let e;
  try {
    e = await getExpense(actor, expenseId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { timezone } = await getAgencyContext(actor);
  return <ExpenseDetail expense={e} backHref="/admin/expenses" backLabel="Expenses" base={e.isMine ? "/work/expenses" : "/admin/expenses"} timeZone={timezone} shootHref="/admin/shoots" />;
}
