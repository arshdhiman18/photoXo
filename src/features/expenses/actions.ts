"use server";

import { revalidatePath } from "next/cache";
import { authedAction } from "@/server/actions/safe-action";
import { canApproveExpenses, canSubmitExpenses } from "@/server/authz/permissions";
import {
  createExpense,
  decideExpense,
  submitExpense,
  updateExpense,
  withdrawExpense,
} from "@/server/services/expenses.service";
import { createExpenseSchema, decideExpenseSchema, expenseTargetSchema, updateExpenseSchema } from "./schemas";

// Capability before validation; ownership, status and self-approval rules in the service.

function revalidateExpenses(id?: string) {
  revalidatePath("/work/expenses");
  revalidatePath("/admin/expenses");
  if (id) {
    revalidatePath(`/work/expenses/${id}`);
    revalidatePath(`/admin/expenses/${id}`);
  }
}

const claimant = { authorize: canSubmitExpenses };

export const createExpenseAction = authedAction(
  createExpenseSchema,
  async (actor, input) => {
    const r = await createExpense(actor, input);
    revalidateExpenses(r.id);
    return r;
  },
  claimant,
);

export const updateExpenseAction = authedAction(
  updateExpenseSchema,
  async (actor, input) => {
    await updateExpense(actor, input);
    revalidateExpenses(input.expenseId);
  },
  claimant,
);

export const submitExpenseAction = authedAction(
  expenseTargetSchema,
  async (actor, input) => {
    await submitExpense(actor, input.expenseId);
    revalidateExpenses(input.expenseId);
  },
  claimant,
);

export const withdrawExpenseAction = authedAction(
  expenseTargetSchema,
  async (actor, input) => {
    await withdrawExpense(actor, input.expenseId);
    revalidateExpenses(input.expenseId);
  },
  claimant,
);

export const decideExpenseAction = authedAction(
  decideExpenseSchema,
  async (actor, input) => {
    await decideExpense(actor, input);
    revalidateExpenses(input.expenseId);
  },
  { authorize: canApproveExpenses },
);
